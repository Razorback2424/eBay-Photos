import os
import shutil


def safe_under(root, path):
    root_abs = os.path.abspath(root)
    path_abs = os.path.abspath(path)
    return path_abs == root_abs or path_abs.startswith(root_abs + os.sep)


def job_card_tiles(job_id, cards_root, expected_jpgs_per_card, preview_url_builder, limit=120):
    tiles = []
    if not cards_root or not os.path.isdir(cards_root):
        return tiles
    pair_dirs = [d for d in sorted(os.listdir(cards_root)) if os.path.isdir(os.path.join(cards_root, d))]
    for pair_name in pair_dirs:
        pair_dir = os.path.join(cards_root, pair_name)
        for card_folder in sorted(os.listdir(pair_dir)):
            card_dir = os.path.join(pair_dir, card_folder)
            if not os.path.isdir(card_dir):
                continue
            jpgs = [f for f in sorted(os.listdir(card_dir)) if f.lower().endswith(".jpg")]
            front_file = next((f for f in jpgs if f.upper().endswith("_FRONT.JPG")), None)
            back_file = next((f for f in jpgs if f.upper().endswith("_BACK.JPG")), None)
            front_url = None
            back_url = None
            if front_file:
                rel = os.path.join(pair_name, card_folder, front_file).replace(os.sep, "/")
                front_url = preview_url_builder(job_id, rel)
            if back_file:
                rel = os.path.join(pair_name, card_folder, back_file).replace(os.sep, "/")
                back_url = preview_url_builder(job_id, rel)
            tiles.append(
                {
                    "pair_name": pair_name,
                    "card_name": card_folder,
                    "front_url": front_url,
                    "back_url": back_url,
                    "image_count": len(jpgs),
                    "warning": len(jpgs) != expected_jpgs_per_card,
                }
            )
            if len(tiles) >= limit:
                return tiles
    return tiles


def resolve_zip_path(run_dir, cards_root=None, zip_path=None):
    if not zip_path:
        candidate = os.path.join(run_dir, "cards_bundle.zip")
        if os.path.exists(candidate):
            zip_path = candidate
    if not cards_root:
        cards_candidate = os.path.join(run_dir, "cards")
        if os.path.isdir(cards_candidate):
            cards_root = cards_candidate
    if (not zip_path or not os.path.exists(zip_path)) and cards_root and os.path.isdir(cards_root):
        zip_base = os.path.join(run_dir, "cards_bundle")
        try:
            rebuilt = shutil.make_archive(base_name=zip_base, format="zip", root_dir=cards_root)
            if rebuilt and os.path.exists(rebuilt):
                zip_path = rebuilt
        except Exception:
            pass
    return zip_path, cards_root


def delete_run_dir_if_safe(runs_root, run_dir):
    if not run_dir:
        return False
    if not safe_under(runs_root, run_dir):
        return False
    if not os.path.isdir(run_dir):
        return False
    shutil.rmtree(run_dir, ignore_errors=True)
    return True
