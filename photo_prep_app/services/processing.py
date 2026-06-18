import io
import os
import shutil
import threading
from contextlib import redirect_stdout
from datetime import datetime


def normalize_ext(filename, allowed_extensions):
    ext = os.path.splitext(filename or "")[1].lower()
    return ext if ext in allowed_extensions else None


def safe_label(label):
    cleaned = "".join(ch if ch.isalnum() or ch in ("-", "_") else "-" for ch in (label or "").strip())
    cleaned = cleaned.strip("-_")
    return cleaned[:60] if cleaned else ""


def build_pairs(front_files, back_files, inputs_dir, pair_names=None, allowed_extensions=None, label_sanitizer=None):
    allowed_extensions = allowed_extensions or {".jpg", ".jpeg", ".png", ".heic"}
    label_sanitizer = label_sanitizer or safe_label
    errors = []
    valid_fronts = []
    valid_backs = []

    for f in front_files:
        if not f or not f.filename:
            continue
        if not normalize_ext(f.filename, allowed_extensions):
            errors.append(f"Unsupported front extension: {f.filename}")
            continue
        valid_fronts.append(f)

    for f in back_files:
        if not f or not f.filename:
            continue
        if not normalize_ext(f.filename, allowed_extensions):
            errors.append(f"Unsupported back extension: {f.filename}")
            continue
        valid_backs.append(f)

    if len(valid_fronts) != len(valid_backs):
        errors.append(
            f"Front/back count mismatch: {len(valid_fronts)} front file(s), {len(valid_backs)} back file(s)."
        )
        return [], errors

    pairs = []
    used_keys = set()
    for idx, (front_file, back_file) in enumerate(zip(valid_fronts, valid_backs), start=1):
        requested_name = ""
        if isinstance(pair_names, list) and idx - 1 < len(pair_names):
            requested_name = label_sanitizer(pair_names[idx - 1])
        key = requested_name or f"pair-{idx:04d}"
        if key in used_keys:
            key = f"{key}-{idx:04d}"
        used_keys.add(key)
        pair_dir = os.path.join(inputs_dir, key)
        os.makedirs(pair_dir, exist_ok=True)
        front_ext = normalize_ext(front_file.filename, allowed_extensions)
        back_ext = normalize_ext(back_file.filename, allowed_extensions)
        front_path = os.path.join(pair_dir, f"fronts{front_ext}")
        back_path = os.path.join(pair_dir, f"backs{back_ext}")
        front_file.save(front_path)
        back_file.save(back_path)

        pairs.append(
            {
                "key": key,
                "front_path": front_path,
                "back_path": back_path,
                "front_name": os.path.basename(front_file.filename or front_path),
                "back_name": os.path.basename(back_file.filename or back_path),
            }
        )

    return pairs, errors


def collect_folder_stats(cards_dir):
    folders = []
    if not os.path.isdir(cards_dir):
        return folders
    for name in sorted(os.listdir(cards_dir)):
        folder_path = os.path.join(cards_dir, name)
        if not os.path.isdir(folder_path):
            continue
        jpgs = len([f for f in os.listdir(folder_path) if f.lower().endswith(".jpg")])
        folders.append({"name": name, "jpgs": jpgs})
    return folders


def find_output_mismatches(folder_stats, expected_jpgs):
    mismatches = []
    for item in folder_stats:
        if item["jpgs"] != expected_jpgs:
            mismatches.append(f"{item['name']}: expected {expected_jpgs} jpg, found {item['jpgs']}")
    return mismatches


def prune_jobs(jobs, job_lock, max_jobs_in_memory):
    with job_lock:
        if len(jobs) <= max_jobs_in_memory:
            return
        ordered = sorted(jobs.values(), key=lambda j: j["created_at"])
        remove_count = len(jobs) - max_jobs_in_memory
        for j in ordered[:remove_count]:
            if j["status"] in {"completed", "completed_with_warnings", "failed", "expired"}:
                jobs.pop(j["id"], None)


def recent_jobs(jobs, job_lock, status_label_fn, limit=8):
    with job_lock:
        items = sorted(jobs.values(), key=lambda j: j["created_at"], reverse=True)
        return [
            {
                "id": j["id"],
                "batch_name": j.get("batch_name", ""),
                "status": j["status"],
                "status_label": status_label_fn(j["status"]),
                "pair_count": j["pair_count"],
                "total_cards": j.get("total_cards", 0),
            }
            for j in items[:limit]
        ]


def queue_snapshot(jobs, job_lock):
    with job_lock:
        queued = sum(1 for j in jobs.values() if j["status"] == "queued")
        running = sum(1 for j in jobs.values() if j["status"] == "running")
    return queued, running


def session_card_count(jobs, job_lock):
    with job_lock:
        return sum(int(j.get("total_cards", 0) or 0) for j in jobs.values())


def update_job(jobs, job_lock, job_id, **kwargs):
    with job_lock:
        job = jobs.get(job_id)
        if not job:
            return
        job.update(kwargs)


def append_log(jobs, job_lock, job_id, text):
    with job_lock:
        job = jobs.get(job_id)
        if not job:
            return
        job["run_log"] += text


def worker_loop(
    job_queue,
    jobs,
    job_lock,
    *,
    process_scans_fn,
    expected_jpgs_per_card,
    max_jobs_in_memory,
    persist_job_snapshot_fn=None,
):
    def persist(job_id):
        if not persist_job_snapshot_fn:
            return
        try:
            persist_job_snapshot_fn(job_id)
        except Exception:
            # Persistence failures should not interrupt image processing.
            return

    while True:
        job_id = job_queue.get()
        try:
            with job_lock:
                job = jobs.get(job_id)
                if not job:
                    job_queue.task_done()
                    continue
                job["status"] = "running"
                job["started_at"] = datetime.now().isoformat(timespec="seconds")
            persist(job_id)

            for pair in job["pairs"]:
                pair_name = pair["key"]
                cards_dir = os.path.join(job["cards_root"], pair_name)
                os.makedirs(cards_dir, exist_ok=True)
                append_log(jobs, job_lock, job_id, f"\n=== Pair: {pair_name} ===\n")

                buffer = io.StringIO()
                with redirect_stdout(buffer):
                    exit_code = process_scans_fn(
                        front_filename=pair["front_path"],
                        back_filename=pair["back_path"],
                        mode=job["mode"],
                        output_root=cards_dir,
                        archive_root=os.path.join(job["run_dir"], "archive"),
                        archive=False,
                        use_full_frame=True,
                    )

                pair_log = buffer.getvalue()
                append_log(jobs, job_lock, job_id, pair_log)
                folders = collect_folder_stats(cards_dir)
                card_count = len(folders)
                image_count = sum(x["jpgs"] for x in folders)
                mismatches = find_output_mismatches(folders, expected_jpgs_per_card)
                pair_status = "ok" if (exit_code == 0 and not mismatches) else "warning"
                if mismatches:
                    append_log(jobs, job_lock, job_id, "Output mismatch detected:\n")
                    for line in mismatches:
                        append_log(jobs, job_lock, job_id, f"  - {line}\n")

                with job_lock:
                    live = jobs.get(job_id)
                    if not live:
                        continue
                    live["processed_pairs"] += 1
                    live["total_cards"] += card_count
                    live["total_images"] += image_count
                    live["pair_results"].append(
                        {
                            "name": pair_name,
                            "front_name": pair.get("front_name", ""),
                            "back_name": pair.get("back_name", ""),
                            "status": pair_status,
                            "card_count": card_count,
                            "image_count": image_count,
                            "exit_code": exit_code,
                        }
                    )
                    if mismatches:
                        live["output_warnings"] += (
                            f"Pair {pair_name}\n" + "\n".join(f"  - {m}" for m in mismatches) + "\n"
                        )
                persist(job_id)

            zip_base = os.path.join(job["run_dir"], "cards_bundle")
            shutil.make_archive(base_name=zip_base, format="zip", root_dir=job["cards_root"])

            with job_lock:
                live = jobs.get(job_id)
                has_warnings = bool(
                    live and any(pr.get("status") == "warning" for pr in live.get("pair_results", []))
                )
            update_job(
                jobs,
                job_lock,
                job_id,
                status=("completed_with_warnings" if has_warnings else "completed"),
                finished_at=datetime.now().isoformat(timespec="seconds"),
                zip_path=f"{zip_base}.zip",
            )
            persist(job_id)
        except Exception as exc:
            update_job(
                jobs,
                job_lock,
                job_id,
                status="failed",
                finished_at=datetime.now().isoformat(timespec="seconds"),
                error=str(exc),
            )
            persist(job_id)
        finally:
            prune_jobs(jobs, job_lock, max_jobs_in_memory)
            job_queue.task_done()


def ensure_worker(
    job_queue,
    jobs,
    job_lock,
    *,
    process_scans_fn,
    expected_jpgs_per_card,
    max_jobs_in_memory,
    persist_job_snapshot_fn=None,
):
    thread = threading.Thread(
        target=worker_loop,
        kwargs={
            "job_queue": job_queue,
            "jobs": jobs,
            "job_lock": job_lock,
            "process_scans_fn": process_scans_fn,
            "expected_jpgs_per_card": expected_jpgs_per_card,
            "max_jobs_in_memory": max_jobs_in_memory,
            "persist_job_snapshot_fn": persist_job_snapshot_fn,
        },
        daemon=True,
        name="scan-worker",
    )
    thread.start()
    return thread
