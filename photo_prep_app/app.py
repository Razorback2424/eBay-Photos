import os
import secrets
import shutil
import threading
import time
import uuid
import logging
import hashlib
from datetime import datetime, timedelta
from queue import Queue

from flask import Flask, Response, abort, redirect, render_template, request, session, url_for

from process_and_organize import process_scans
from . import models
from photo_prep_app.services import auth as auth_service
from photo_prep_app.services import billing as billing_service
from photo_prep_app.services import gumroad as gumroad_service
from photo_prep_app.services import processing as processing_service
from photo_prep_app.services import storage as storage_service

# Optional .env support for local/dev config (master user emails, auth, Stripe, etc.).
try:
    from dotenv import load_dotenv
except Exception:  # pragma: no cover - optional dependency
    load_dotenv = None

try:
    import sentry_sdk
    from sentry_sdk.integrations.flask import FlaskIntegration
except Exception:  # pragma: no cover - optional dependency
    sentry_sdk = None
    FlaskIntegration = None


def _load_dotenv_fallback(dotenv_path):
    if not os.path.isfile(dotenv_path):
        return
    try:
        with open(dotenv_path, "r", encoding="utf-8") as fh:
            for raw_line in fh:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                if not key:
                    continue
                value = value.strip()
                if len(value) >= 2 and ((value[0] == value[-1]) and value[0] in {"'", '"'}):
                    value = value[1:-1]
                os.environ[key] = value
    except Exception:
        # Fallback parsing should never block app startup.
        return

def create_app():
    app = Flask(__name__, template_folder="templates", static_folder="static")
    app.config["SECRET_KEY"] = os.environ.get("PHOTO_PREP_APP_SECRET", "local-dev-secret-change-me")
    app_env = (os.environ.get("APP_ENV") or "development").strip().lower()
    if app_env == "production":
        app.config["SESSION_COOKIE_SECURE"] = True
        app.config["SESSION_COOKIE_HTTPONLY"] = True
        app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
        app.config["PREFERRED_URL_SCHEME"] = "https"
    max_content_mb = int(os.environ.get("MAX_CONTENT_LENGTH_MB", "300") or "300")
    app.config["MAX_CONTENT_LENGTH"] = max(1, max_content_mb) * 1024 * 1024
    return app

PKG_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(PKG_DIR)
dotenv_path = os.path.join(PROJECT_DIR, ".env")
if load_dotenv:
    load_dotenv(dotenv_path, override=True)
else:
    _load_dotenv_fallback(dotenv_path)

app = create_app()
RUNS_ROOT = os.path.join(PROJECT_DIR, "_Web_Runs")
DB_PATH = os.path.join(PROJECT_DIR, "photo_prep_app.db")
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".heic"}
JOB_QUEUE = Queue()
JOB_LOCK = threading.Lock()
JOBS = {}
MAX_JOBS_IN_MEMORY = 100
EXPECTED_JPGS_PER_CARD = 10
RETENTION_HOURS = 24
RETENTION_SWEEP_SECONDS = 300
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://127.0.0.1:5000")
MAX_PAIRS_PER_BATCH = max(1, int(os.environ.get("MAX_PAIRS_PER_BATCH", "100") or "100"))
LOGGER = logging.getLogger("photo_prep_app")
if not LOGGER.handlers:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO").upper())


def _json_log(event, **fields):
    import json
    record = {
        "event": event,
        "ts": datetime.now().isoformat(timespec="seconds"),
    }
    for k, v in fields.items():
        if isinstance(v, (str, int, float, bool)) or v is None:
            record[k] = v
        else:
            record[k] = str(v)
    LOGGER.info(json.dumps(record, sort_keys=True))


def _init_sentry_if_configured():
    dsn = (os.environ.get("SENTRY_DSN") or "").strip()
    if not dsn or not sentry_sdk:
        return False
    sentry_sdk.init(
        dsn=dsn,
        integrations=[FlaskIntegration()] if FlaskIntegration else None,
        environment=(os.environ.get("APP_ENV") or "development"),
        traces_sample_rate=float(os.environ.get("SENTRY_TRACES_SAMPLE_RATE", "0") or "0"),
    )
    return True

def _status_label(status):
    return {
        "queued": "Waiting",
        "running": "Processing",
        "completed": "Complete",
        "completed_with_warnings": "Complete (Needs Review)",
        "failed": "Failed",
        "expired": "Expired",
    }.get(status or "", status or "Unknown")


def _csrf_token():
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return token


def _validate_csrf():
    expected = session.get("csrf_token")
    provided = (
        request.headers.get("X-CSRF-Token")
        or request.form.get("csrf_token")
        or request.headers.get("X-CSRFToken")
    )
    return bool(expected and provided and secrets.compare_digest(str(expected), str(provided)))


def _parse_iso(value):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except Exception:
        return None


def _format_ts(dt_value):
    if not dt_value:
        return None
    return dt_value.strftime("%Y-%m-%d %H:%M:%S")


def _recent_jobs(limit=8):
    auth = _auth_state()
    if not (auth.get("is_authenticated") and auth.get("user")):
        return []
    owner_id = auth["user"]["id"]
    items = models.list_recent_batches(DB_PATH, limit=limit, owner_id=owner_id)
    for item in items:
        item["status_label"] = _status_label(item.get("status"))
    return items


def _render_workspace(error=None):
    queued, running = _queue_snapshot()
    account = _account_state()
    return render_template(
        "workspace.html",
        error=error,
        recent_jobs=_recent_jobs(limit=4),
        queue_count=queued,
        running_count=running,
        expected_per_card=EXPECTED_JPGS_PER_CARD,
        session_cards=_session_card_count(),
        status_label=_status_label,
        account=account,
        show_onboarding_notice=False,
    )

def _queue_snapshot():
    return processing_service.queue_snapshot(JOBS, JOB_LOCK)


def _session_card_count():
    auth = _auth_state()
    if not (auth.get("is_authenticated") and auth.get("user")):
        return 0
    owner_id = auth["user"]["id"]
    return models.total_cards_processed(DB_PATH, owner_id=owner_id)


def _account_state():
    auth = _auth_state()
    user = auth.get("user") if auth.get("is_authenticated") else None
    if not user:
        return None
    return billing_service.account_state(
        models,
        DB_PATH,
        account_id=user["id"],
        account_email=user.get("email"),
        ensure_default=True,
    )


def _auth_state():
    return auth_service.auth_state()


def _current_user():
    auth = _auth_state()
    return auth.get("user") if auth.get("is_authenticated") else None


def _update_job(job_id, **kwargs):
    processing_service.update_job(JOBS, JOB_LOCK, job_id, **kwargs)


def _append_log(job_id, text):
    processing_service.append_log(JOBS, JOB_LOCK, job_id, text)


def _persist_job_snapshot(job_id):
    with JOB_LOCK:
        job = JOBS.get(job_id)
        if not job:
            return
        snapshot = dict(job)
        snapshot["pair_results"] = [dict(x) for x in job.get("pair_results", [])]
    models.upsert_batch_from_job(DB_PATH, snapshot)
    billing_service.maybe_record_batch_usage(models, DB_PATH, snapshot)
    if snapshot.get("status") in {"completed", "completed_with_warnings", "failed"}:
        _json_log(
            "batch_persisted_terminal",
            batch_id=snapshot.get("id"),
            owner_id=snapshot.get("owner_id"),
            status=snapshot.get("status"),
            pair_count=snapshot.get("pair_count"),
            total_cards=snapshot.get("total_cards"),
            total_images=snapshot.get("total_images"),
        )


def _is_job_owned_by_current_user(job):
    user = _current_user()
    if not user:
        return False
    return (job.get("owner_id") or "local") == user.get("id")


def _safe_under(root, path):
    return storage_service.safe_under(root, path)


def _job_card_tiles(job_id, cards_root, limit=120):
    return storage_service.job_card_tiles(
        job_id,
        cards_root,
        EXPECTED_JPGS_PER_CARD,
        preview_url_builder=lambda job_id_, rel: url_for("job_preview_image", job_id=job_id_, relpath=rel),
        limit=limit,
    )


def _job_view_snapshot(job):
    snapshot = dict(job)
    snapshot["pair_results"] = []
    for item in job.get("pair_results", []):
        row = dict(item)
        row["status_label"] = "OK" if row.get("status") == "ok" else "Needs Review"
        snapshot["pair_results"].append(row)
    created_dt = _parse_iso(job.get("created_at"))
    expires_dt = created_dt + timedelta(hours=RETENTION_HOURS) if created_dt else None
    snapshot["created_at"] = _format_ts(created_dt) or (job.get("created_at") or "")
    snapshot["expires_at"] = _format_ts(expires_dt) if expires_dt else None
    snapshot["status_label"] = _status_label(job.get("status"))
    snapshot["batch_name"] = job.get("batch_name", "")
    snapshot["page_title"] = (
        "Batch Processing" if job.get("status") in {"queued", "running"} else "Batch Complete"
        if job.get("status") in {"completed", "completed_with_warnings"}
        else "Batch Status"
    )
    pair_count = int(job.get("pair_count", 0) or 0)
    processed_pairs = int(job.get("processed_pairs", 0) or 0)
    progress_percent = 0
    if pair_count > 0:
        progress_percent = max(0, min(100, int(round((processed_pairs / pair_count) * 100))))
    if job.get("status") in {"completed", "completed_with_warnings", "failed"}:
        progress_percent = 100 if job.get("status") != "failed" else progress_percent
    snapshot["progress_percent"] = progress_percent
    if job.get("status") == "queued":
        snapshot["progress_label"] = f"Waiting to start ({pair_count} pair{'s' if pair_count != 1 else ''} queued)"
    elif job.get("status") == "running":
        snapshot["progress_label"] = f"Processing {processed_pairs} of {pair_count} pairs"
    elif job.get("status") in {"completed", "completed_with_warnings"}:
        snapshot["progress_label"] = "Packaging complete. Download is ready."
    elif job.get("status") == "failed":
        snapshot["progress_label"] = "Batch failed. Review the error and warnings below."
    else:
        snapshot["progress_label"] = snapshot["status_label"]
    snapshot["card_tiles"] = _job_card_tiles(job["id"], job.get("cards_root"))
    return snapshot


def _not_found_page(title, message, code=404):
    return (
        render_template("not_found.html", title=title, message=message, auth=_auth_state()),
        code,
    )


def _build_pairs(front_files, back_files, inputs_dir, pair_names=None):
    return processing_service.build_pairs(
        front_files,
        back_files,
        inputs_dir,
        pair_names=pair_names,
        allowed_extensions=ALLOWED_EXTENSIONS,
        label_sanitizer=processing_service.safe_label,
    )


def _ensure_worker():
    return processing_service.ensure_worker(
        JOB_QUEUE,
        JOBS,
        JOB_LOCK,
        process_scans_fn=process_scans,
        expected_jpgs_per_card=EXPECTED_JPGS_PER_CARD,
        max_jobs_in_memory=MAX_JOBS_IN_MEMORY,
        persist_job_snapshot_fn=_persist_job_snapshot,
    )


def _retention_sweep_once():
    cutoff = (datetime.now() - timedelta(hours=RETENTION_HOURS)).isoformat(timespec="seconds")
    expired = models.list_batches_past_retention(DB_PATH, cutoff, limit=100)
    if not expired:
        return 0
    count = 0
    for item in expired:
        batch_id = item.get("id")
        run_dir = item.get("run_dir")
        storage_service.delete_run_dir_if_safe(RUNS_ROOT, run_dir)
        models.mark_batch_expired(DB_PATH, batch_id)
        with JOB_LOCK:
            live = JOBS.get(batch_id)
            if live:
                live["status"] = "expired"
                live["zip_path"] = None
        count += 1
    return count


def _retention_worker_loop():
    while True:
        try:
            _retention_sweep_once()
        except Exception:
            # Retention failures should not bring down the app.
            pass
        time.sleep(RETENTION_SWEEP_SECONDS)


def _ensure_retention_worker():
    thread = threading.Thread(target=_retention_worker_loop, daemon=True, name="retention-worker")
    thread.start()
    return thread


def _readiness_issues():
    issues = []
    if app.config.get("SECRET_KEY") == "local-dev-secret-change-me":
        issues.append("PHOTO_PREP_APP_SECRET is using the default development value.")
    if auth_service.auth_mode() == "auth0" and not auth_service.auth0_ready():
        issues.append("Auth0 mode is enabled but AUTH0_* variables are incomplete.")
    if auth_service.auth_mode() == "gumroad" and not gumroad_service.launch_ready():
        issues.append("Gumroad launch mode is enabled but GUMROAD_* configuration is incomplete.")
    if auth_service.auth_mode() != "gumroad":
        if not STRIPE_WEBHOOK_SECRET:
            issues.append("STRIPE_WEBHOOK_SECRET is not configured.")
        if not billing_service.stripe_checkout_ready():
            issues.append("Stripe Checkout is not configured (STRIPE_SECRET_KEY / STRIPE_PRICE_ID / APP_BASE_URL).")
        if not billing_service.stripe_portal_ready():
            issues.append("Stripe Billing Portal is not configured (STRIPE_SECRET_KEY / APP_BASE_URL).")
    if billing_service.is_production() and billing_service.demo_billing_controls_enabled():
        issues.append("Demo billing controls are enabled in production.")
    if shutil.which("tesseract") is None:
        issues.append("tesseract executable is not installed or not on PATH.")
    try:
        os.makedirs(RUNS_ROOT, exist_ok=True)
        test_path = os.path.join(RUNS_ROOT, ".write_test")
        with open(test_path, "w", encoding="utf-8") as fh:
            fh.write("ok")
        os.remove(test_path)
    except Exception:
        issues.append("_Web_Runs directory is not writable.")
    try:
        if not models.health_check(DB_PATH):
            issues.append("Database health check failed.")
    except Exception as exc:
        issues.append(f"Database health check failed: {exc}")
    return issues


@app.context_processor
def inject_app_context():
    return {
        "auth": _auth_state(),
        "auth_mode": auth_service.auth_mode(),
        "csrf_token": _csrf_token(),
        "app_env": billing_service.app_env(),
        "demo_billing_controls_enabled": billing_service.demo_billing_controls_enabled(),
        "launch_mode": auth_service.launch_mode_enabled(),
        "support_email": auth_service.support_email(),
        "purchase_url": auth_service.gumroad_product_url(),
        "plausible_domain": auth_service.plausible_domain(),
        "plausible_script_src": auth_service.plausible_script_src(),
    }


@app.errorhandler(413)
def request_entity_too_large(_err):
    return _not_found_page(
        "Upload Too Large",
        "This upload is too large for the current server limit. Split the batch into smaller uploads and try again.",
        code=413,
    )


@app.get("/healthz")
def healthz():
    return Response('{"ok":true}', mimetype="application/json")


@app.get("/readiness")
def readiness():
    issues = _readiness_issues()
    ok = not issues
    body = json_body({"ok": ok, "issues": issues})
    return Response(body, mimetype="application/json", status=(200 if ok else 503))


def json_body(data):
    import json
    return json.dumps(data)


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/dashboard")
def dashboard():
    return render_template("index.html")


@app.get("/workspace")
@auth_service.require_login
def workspace():
    return render_template(
        "workspace.html",
        error=None,
        recent_jobs=_recent_jobs(limit=4),
        queue_count=_queue_snapshot()[0],
        running_count=_queue_snapshot()[1],
        expected_per_card=EXPECTED_JPGS_PER_CARD,
        session_cards=_session_card_count(),
        status_label=_status_label,
        account=_account_state(),
        show_onboarding_notice=bool(session.pop("show_onboarding_notice", False)),
    )


@app.get("/batches")
@auth_service.require_login
def batches_page():
    user = _current_user()
    items = models.list_recent_batches(DB_PATH, limit=50, owner_id=(user or {}).get("id"))
    for item in items:
        item["status_label"] = _status_label(item.get("status"))
    return render_template(
        "batches.html",
        batches=items,
        account=_account_state(),
    )


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None
    next_url = request.values.get("next") or url_for("workspace")
    if request.method == "POST" and auth_service.auth_mode() == "gumroad":
        if not _validate_csrf():
            _json_log("auth_login_csrf_failed", mode="gumroad", remote_addr=request.remote_addr)
            return render_template("login.html", error="Security check failed. Refresh and try again.", next_url=next_url), 400
        ok, result = gumroad_service.verify_license(request.form.get("email"), request.form.get("license_key"))
        if not ok:
            _json_log("auth_login_gumroad_failed", email=request.form.get("email"), reason=result)
            return render_template("login.html", error=result, next_url=next_url), 400
        user = auth_service.sign_in_gumroad(result.get("email"), name=result.get("name") or "")
        models.set_subscription(
            DB_PATH,
            user["id"],
            account_email=user.get("email"),
            status="active",
            plan_name="Gumroad Access",
            cards_per_month_limit=0,
        )
        session["show_onboarding_notice"] = True
        _json_log("auth_login_gumroad_success", user_id=user.get("id"), email=user.get("email"))
        return redirect(next_url)
    if request.method == "POST" and auth_service.auth_mode() == "demo":
        if not _validate_csrf():
            _json_log("auth_login_csrf_failed", mode="demo", remote_addr=request.remote_addr)
            return render_template("login.html", error="Security check failed. Refresh and try again.", next_url=next_url), 400
        user = auth_service.sign_in_demo(request.form.get("email"))
        _json_log("auth_login_demo_success", user_id=user.get("id"), email=user.get("email"))
        return redirect(next_url)
    if request.method == "GET" and auth_service.auth_mode() == "auth0":
        if not auth_service.auth0_ready():
            error = "Auth0 is not configured. Set AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, and AUTH0_CALLBACK_URL."
        else:
            _json_log("auth_login_auth0_redirect", next_url=next_url)
            return redirect(auth_service.begin_auth0_login(next_url))
    return render_template("login.html", error=error, next_url=next_url)


@app.get("/auth/callback")
def auth_callback():
    if auth_service.auth_mode() != "auth0":
        return redirect(url_for("workspace"))
    expected_state = session.get("auth0_state")
    received_state = request.args.get("state")
    code = request.args.get("code")
    if not expected_state or not received_state or expected_state != received_state or not code:
        _json_log("auth_callback_validation_failed", remote_addr=request.remote_addr)
        return render_template("login.html", error="Authentication callback validation failed.", next_url=url_for("workspace")), 400
    try:
        token_data = auth_service.exchange_auth0_code(code)
        access_token = token_data.get("access_token")
        if not access_token:
            raise RuntimeError("Missing access token")
        userinfo = auth_service.fetch_auth0_userinfo(access_token)
    except Exception as exc:
        _json_log("auth_callback_failed", error=str(exc))
        return render_template("login.html", error=f"Authentication failed: {exc}", next_url=url_for("workspace")), 400

    user = {
        "id": userinfo.get("sub") or userinfo.get("email") or "auth0-user",
        "email": userinfo.get("email") or "",
        "name": userinfo.get("name") or (userinfo.get("nickname") or ""),
        "provider": "auth0",
    }
    auth_service.sign_in_user(user)
    _json_log("auth_login_auth0_success", user_id=user.get("id"), email=user.get("email"))
    next_url = session.pop("auth_next", None) or url_for("workspace")
    session.pop("auth0_state", None)
    return redirect(next_url)


@app.get("/logout")
def logout():
    auth = _auth_state()
    _json_log("auth_logout", user_id=((auth.get("user") or {}).get("id")), email=((auth.get("user") or {}).get("email")))
    auth_service.sign_out()
    if auth.get("mode") == "auth0" and auth_service.auth0_ready():
        return redirect(auth_service.auth0_logout_url(APP_BASE_URL.rstrip("/") + url_for("workspace")))
    return redirect(url_for("workspace"))


@app.get("/account")
@auth_service.require_login
def account_page():
    return render_template(
        "account.html",
        account=_account_state(),
        stripe_checkout_ready=billing_service.stripe_checkout_ready(),
        stripe_portal_ready=billing_service.stripe_portal_ready(),
        auth_mode=auth_service.auth_mode(),
        billing_message=request.args.get("billing_message", ""),
    )


@app.get("/billing/checkout")
@auth_service.require_login
def billing_checkout():
    if auth_service.auth_mode() == "gumroad":
        return redirect(url_for("account_page", billing_message="Billing is handled through Gumroad. Use the link in your receipt or contact support."))
    user = _current_user()
    account = _account_state()
    demo = request.args.get("demo")
    if demo and not billing_service.demo_billing_controls_enabled():
        _json_log("billing_demo_control_blocked", route="checkout", user_id=user.get("id"))
        return redirect(url_for("account_page", billing_message="Demo billing controls are disabled in production."))
    if demo == "activate":
        models.set_subscription(DB_PATH, user["id"], account_email=user.get("email"), status="active", plan_name="CardWorks Pro", cards_per_month_limit=5000)
    elif demo == "trial":
        models.set_subscription(DB_PATH, user["id"], account_email=user.get("email"), status="trialing", plan_name="Starter Trial", cards_per_month_limit=200)
    elif demo == "no_subscription":
        models.set_subscription(DB_PATH, user["id"], account_email=user.get("email"), status="no_subscription", plan_name="No Plan", cards_per_month_limit=0)
    elif demo == "incomplete":
        models.set_subscription(DB_PATH, user["id"], account_email=user.get("email"), status="incomplete")
    elif billing_service.stripe_checkout_ready():
        try:
            session_data = billing_service.create_checkout_session(account)
            checkout_url = session_data.get("url")
            if checkout_url:
                _json_log("billing_checkout_redirect", user_id=user.get("id"), stripe_customer_id=account.get("stripe_customer_id"))
                return redirect(checkout_url)
            return redirect(url_for("account_page", billing_message="Stripe checkout session did not return a URL."))
        except Exception as exc:
            _json_log("billing_checkout_error", user_id=user.get("id"), error=str(exc))
            return redirect(url_for("account_page", billing_message=f"Stripe checkout error: {exc}"))
    return redirect(url_for("account_page"))


@app.get("/billing/portal")
@auth_service.require_login
def billing_portal():
    if auth_service.auth_mode() == "gumroad":
        return redirect(url_for("account_page", billing_message="Billing is handled through Gumroad. Use your Gumroad receipt to manage access."))
    user = _current_user()
    demo = request.args.get("demo")
    if demo and not billing_service.demo_billing_controls_enabled():
        _json_log("billing_demo_control_blocked", route="portal", user_id=user.get("id"))
        return redirect(url_for("account_page", billing_message="Demo billing controls are disabled in production."))
    if demo == "past_due":
        models.set_subscription(DB_PATH, user["id"], account_email=user.get("email"), status="past_due")
    elif demo == "canceled":
        models.set_subscription(DB_PATH, user["id"], account_email=user.get("email"), status="canceled")
    elif demo == "active":
        models.set_subscription(DB_PATH, user["id"], account_email=user.get("email"), status="active", plan_name="CardWorks Pro", cards_per_month_limit=5000)
    elif billing_service.stripe_portal_ready():
        try:
            portal = billing_service.create_billing_portal_session(_account_state())
            portal_url = portal.get("url")
            if portal_url:
                _json_log("billing_portal_redirect", user_id=user.get("id"))
                return redirect(portal_url)
            return redirect(url_for("account_page", billing_message="Stripe billing portal did not return a URL."))
        except Exception as exc:
            _json_log("billing_portal_error", user_id=user.get("id"), error=str(exc))
            return redirect(url_for("account_page", billing_message=f"Billing portal error: {exc}"))
    return redirect(url_for("account_page"))


@app.post("/webhooks/stripe")
def stripe_webhook():
    payload = request.get_data(cache=False, as_text=False)
    ok, reason = billing_service.verify_stripe_signature(
        payload,
        request.headers.get("Stripe-Signature"),
        STRIPE_WEBHOOK_SECRET,
    )
    if not ok:
        _json_log("stripe_webhook_rejected", reason=reason)
        return Response(f"invalid webhook signature: {reason}", status=400)
    try:
        event = billing_service.parse_json_event(payload)
    except Exception:
        _json_log("stripe_webhook_invalid_json")
        return Response("invalid json payload", status=400)
    event_id = (event.get("id") or "").strip()
    event_type = event.get("type")
    payload_sha256 = hashlib.sha256(payload).hexdigest()
    if event_id:
        inserted = models.insert_webhook_event_receipt(
            DB_PATH,
            event_id=event_id,
            provider="stripe",
            event_type=event_type,
            payload_sha256=payload_sha256,
        )
        if not inserted:
            _json_log("stripe_webhook_duplicate_ignored", event_id=event_id, event_type=event_type)
            return Response('{"received":true,"duplicate":true}', mimetype="application/json", status=200)
    try:
        result = billing_service.apply_stripe_event_to_subscription(models, DB_PATH, event)
    except Exception as exc:
        if event_id:
            models.mark_webhook_event_processed(
                DB_PATH,
                event_id=event_id,
                processed_ok=False,
                status="error",
                error=str(exc),
            )
        _json_log("stripe_webhook_processing_error", event_id=event_id, event_type=event_type, error=str(exc))
        return Response("webhook processing error", status=500)
    if event_id:
        models.mark_webhook_event_processed(
            DB_PATH,
            event_id=event_id,
            processed_ok=True,
            status=str(result.get("status") or "processed"),
            error=None,
        )
    _json_log("stripe_webhook_processed", event_type=event.get("type"), updated=result.get("updated"), status=result.get("status"))
    body = (
        "{"
        f"\"received\":true,"
        f"\"updated\":{'true' if result.get('updated') else 'false'},"
        f"\"status\":\"{result.get('status','')}\""
        "}"
    )
    return Response(body, mimetype="application/json", status=200)


@app.post("/enqueue")
@auth_service.require_login
def enqueue_job():
    mode = "fast"
    user = _current_user()
    if not user:
        return redirect(url_for("login", next=url_for("workspace")))
    if not _validate_csrf():
        _json_log("enqueue_csrf_failed", user_id=user.get("id"), email=user.get("email"))
        return _render_workspace(error="Security check failed. Refresh the page and try again."), 400
    batch_name = processing_service.safe_label(request.form.get("batch_name") or request.form.get("run_label"))
    front_files = request.files.getlist("front_files")
    back_files = request.files.getlist("back_files")
    pair_names = request.form.getlist("pair_names")

    has_fronts = any(f and f.filename for f in front_files)
    has_backs = any(f and f.filename for f in back_files)
    if not has_fronts or not has_backs:
        _json_log("enqueue_rejected_empty", user_id=user.get("id"))
        queued, running = _queue_snapshot()
        account = _account_state()
        return render_template(
            "workspace.html",
            error="Upload at least one front scan and one back scan.",
            recent_jobs=_recent_jobs(limit=4),
            queue_count=queued,
            running_count=running,
            expected_per_card=EXPECTED_JPGS_PER_CARD,
            session_cards=_session_card_count(),
            status_label=_status_label,
            account=account,
        )

    os.makedirs(RUNS_ROOT, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    suffix = f"-{batch_name}" if batch_name else ""
    job_id = f"{ts}-{uuid.uuid4().hex[:6]}{suffix}"
    run_dir = os.path.join(RUNS_ROOT, job_id)
    inputs_dir = os.path.join(run_dir, "inputs")
    cards_root = os.path.join(run_dir, "cards")
    os.makedirs(inputs_dir, exist_ok=True)
    os.makedirs(cards_root, exist_ok=True)

    pairs, errors = _build_pairs(front_files, back_files, inputs_dir, pair_names=pair_names)
    if errors:
        _json_log("enqueue_rejected_validation", user_id=user.get("id"), error="; ".join(errors))
        shutil.rmtree(run_dir, ignore_errors=True)
        queued, running = _queue_snapshot()
        account = _account_state()
        return render_template(
            "workspace.html",
            error="; ".join(errors),
            recent_jobs=_recent_jobs(limit=4),
            queue_count=queued,
            running_count=running,
            expected_per_card=EXPECTED_JPGS_PER_CARD,
            session_cards=_session_card_count(),
            status_label=_status_label,
            account=account,
        )
    if not pairs:
        _json_log("enqueue_rejected_no_pairs", user_id=user.get("id"))
        shutil.rmtree(run_dir, ignore_errors=True)
        queued, running = _queue_snapshot()
        account = _account_state()
        return render_template(
            "workspace.html",
            error="No valid front/back pairs found.",
            recent_jobs=_recent_jobs(limit=4),
            queue_count=queued,
            running_count=running,
            expected_per_card=EXPECTED_JPGS_PER_CARD,
            session_cards=_session_card_count(),
            status_label=_status_label,
            account=account,
        )
    if len(pairs) > MAX_PAIRS_PER_BATCH:
        shutil.rmtree(run_dir, ignore_errors=True)
        _json_log("enqueue_rejected_max_pairs", user_id=user.get("id"), pair_count=len(pairs), max_pairs=MAX_PAIRS_PER_BATCH)
        return _render_workspace(
            error=f"Batch too large: {len(pairs)} pairs uploaded. Maximum per batch is {MAX_PAIRS_PER_BATCH}."
        )

    account = _account_state()
    allowed, deny_message = billing_service.can_start_batch(account, requested_cards=len(pairs))
    if not allowed:
        shutil.rmtree(run_dir, ignore_errors=True)
        _json_log("enqueue_rejected_billing", user_id=user.get("id"), pair_count=len(pairs), reason=deny_message)
        queued, running = _queue_snapshot()
        return render_template(
            "workspace.html",
            error=deny_message,
            recent_jobs=_recent_jobs(limit=4),
            queue_count=queued,
            running_count=running,
            expected_per_card=EXPECTED_JPGS_PER_CARD,
            session_cards=_session_card_count(),
            status_label=_status_label,
            account=account,
        )

    job = {
        "id": job_id,
        "owner_id": user["id"],
        "owner_email": user.get("email", ""),
        "status": "queued",
        "mode": mode,
        "batch_name": batch_name,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "started_at": None,
        "finished_at": None,
        "error": None,
        "run_dir": run_dir,
        "cards_root": cards_root,
        "zip_path": None,
        "pairs": pairs,
        "pair_count": len(pairs),
        "processed_pairs": 0,
        "total_cards": 0,
        "total_images": 0,
        "pair_results": [],
        "run_log": "",
        "output_warnings": "",
    }

    with JOB_LOCK:
        JOBS[job_id] = job
    _persist_job_snapshot(job_id)
    JOB_QUEUE.put(job_id)
    _json_log("batch_enqueued", batch_id=job_id, user_id=user.get("id"), email=user.get("email"), pair_count=len(pairs))
    return redirect(url_for("job_status", job_id=job_id))


@app.get("/job/<job_id>")
@auth_service.require_login
def job_status(job_id):
    with JOB_LOCK:
        job = JOBS.get(job_id)
        if job and _is_job_owned_by_current_user(job):
            snapshot = _job_view_snapshot(job)
        else:
            snapshot = None
    if snapshot is None:
        user = _current_user()
        persisted = models.get_batch(DB_PATH, job_id, owner_id=(user or {}).get("id"))
        if not persisted:
            return _not_found_page(
                "Batch Not Found",
                "This batch may have expired or the app was restarted before it was reloaded.",
            )
        snapshot = _job_view_snapshot(persisted)
    debug_mode = request.args.get("debug") == "1"
    if billing_service.is_production() or auth_service.launch_mode_enabled():
        debug_mode = False
    return render_template("job.html", job=snapshot, debug_mode=debug_mode)


@app.get("/privacy")
def privacy_page():
    sections = [
        ("What We Process", "CardWorks processes the card images you upload in the browser-based workflow described on the site. The product is positioned around keeping those images out of a remote upload pipeline."),
        ("Account Access", "We store the minimum account information needed to let you sign in, keep access gated, and associate batches with your account."),
        ("Billing and Purchase", "Purchase and license delivery are handled through Gumroad for launch. Payment details are not collected directly by this app."),
        ("Support", f"For privacy questions or deletion requests, contact {auth_service.support_email()}."),
    ]
    return render_template("legal.html", title="Privacy Policy", intro="This is the launch privacy policy for CardWorks.", sections=sections)


@app.get("/terms")
def terms_page():
    sections = [
        ("Access", "A paid license is required to use the protected workspace and batch-processing features."),
        ("Acceptable Use", "Do not abuse the service, bypass the access gate, or use the product in a way that damages availability for other customers."),
        ("Billing", "Launch billing and license fulfillment are handled through Gumroad. Refunds and billing issues follow the terms provided at purchase unless otherwise stated."),
        ("Support", f"If you need help with access or batch processing, contact {auth_service.support_email()}."),
    ]
    return render_template("legal.html", title="Terms of Service", intro="These launch terms govern access to CardWorks.", sections=sections)


@app.get("/batches/<job_id>")
@auth_service.require_login
def batch_status(job_id):
    return job_status(job_id)


@app.get("/preview/<job_id>/<path:relpath>")
@auth_service.require_login
def job_preview_image(job_id, relpath):
    user = _current_user()
    persisted = models.get_batch(DB_PATH, job_id, owner_id=(user or {}).get("id"))
    if not persisted:
        return _not_found_page("Preview Unavailable", "This batch preview is no longer available.")
    if persisted.get("status") == "expired":
        return _not_found_page("Preview Unavailable", "This batch has expired and previews are no longer available.")
    run_dir = os.path.join(RUNS_ROOT, job_id)
    cards_root = os.path.join(run_dir, "cards")
    if not os.path.isdir(cards_root):
        return _not_found_page("Preview Unavailable", "This batch preview is no longer available.")
    image_path = os.path.join(cards_root, relpath)
    if not _safe_under(cards_root, image_path):
        return _not_found_page("Preview Unavailable", "The requested preview image could not be loaded.")
    if not os.path.isfile(image_path) or not image_path.lower().endswith(".jpg"):
        return _not_found_page("Preview Unavailable", "The requested preview image could not be loaded.")

    def generate():
        with open(image_path, "rb") as fh:
            while True:
                chunk = fh.read(1024 * 1024)
                if not chunk:
                    break
                yield chunk

    response = Response(generate(), mimetype="image/jpeg")
    response.headers["Cache-Control"] = "private, max-age=3600"
    return response


@app.get("/download/<job_id>")
@auth_service.require_login
def download_job_zip(job_id):
    user = _current_user()
    zip_path = None
    cards_root = None
    job_status_value = None
    found_batch = False
    run_dir = os.path.join(RUNS_ROOT, job_id)
    with JOB_LOCK:
        job = JOBS.get(job_id)
        if job and _is_job_owned_by_current_user(job):
            found_batch = True
            zip_path = job.get("zip_path")
            cards_root = job.get("cards_root")
            job_status_value = job.get("status")
    if not zip_path or not cards_root:
        persisted = models.get_batch(DB_PATH, job_id, owner_id=(user or {}).get("id"))
        if persisted:
            found_batch = True
            zip_path = zip_path or persisted.get("zip_path")
            cards_root = cards_root or persisted.get("cards_root")
            job_status_value = job_status_value or persisted.get("status")
    if not found_batch:
        return _not_found_page(
            "Download Unavailable",
            "This batch could not be found or you do not have access to it.",
        )
    if job_status_value == "expired":
        return _not_found_page(
            "Download Unavailable",
            "This batch has expired after the retention window. Re-upload to generate a fresh export.",
        )
    if job_status_value not in {"completed", "completed_with_warnings"}:
        return _not_found_page(
            "Download Not Ready",
            "This batch is still processing or did not complete successfully. Open the batch page to review status.",
        )
    zip_path, cards_root = storage_service.resolve_zip_path(run_dir, cards_root=cards_root, zip_path=zip_path)
    if not zip_path or not os.path.exists(zip_path):
        return _not_found_page(
            "Download Unavailable",
            "The export ZIP could not be found. It may have expired or processing may not be complete yet.",
        )
    download_filename = f"{job_id}_cards.zip"

    def generate():
        with open(zip_path, "rb") as fh:
            while True:
                chunk = fh.read(1024 * 1024)
                if not chunk:
                    break
                yield chunk

    response = Response(generate(), mimetype="application/zip")
    response.headers["Content-Disposition"] = f'attachment; filename="{download_filename}"'
    response.headers["Content-Length"] = str(os.path.getsize(zip_path))
    _json_log("batch_download", batch_id=job_id, user_id=(user or {}).get("id"), bytes=os.path.getsize(zip_path))
    return response


@app.get("/batches/<job_id>/download")
@auth_service.require_login
def batch_download(job_id):
    return download_job_zip(job_id)


models.init_db(DB_PATH)
models.mark_incomplete_batches_failed_on_startup(DB_PATH)
models.ensure_local_subscription(DB_PATH)
_init_sentry_if_configured()
_ensure_worker()
_ensure_retention_worker()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
