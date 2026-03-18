from datetime import datetime
import hashlib
import hmac
import json
import os
import urllib.parse
import urllib.request


ALLOWED_PROCESSING_STATUSES = {"trialing", "active"}
BLOCKED_STATUSES = {"past_due", "canceled", "incomplete", "no_subscription"}


def status_label(status):
    return {
        "trialing": "Trial",
        "active": "Active",
        "past_due": "Payment Due",
        "canceled": "Canceled",
        "incomplete": "Checkout Incomplete",
        "no_subscription": "No Subscription",
    }.get(status or "", "Unknown")


def month_key(now=None):
    now = now or datetime.now()
    return now.strftime("%Y-%m")


def _env_bool(name, default=False):
    raw = os.environ.get(name)
    if raw is None:
        return default
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name, default):
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return int(str(raw).strip())
    except Exception:
        return default


def app_env():
    return (os.environ.get("APP_ENV") or "development").strip().lower()


def is_production():
    return app_env() == "production"


def free_trial_enabled():
    return _env_bool("FREE_TRIAL_ENABLED", True)


def free_trial_cards_total():
    return max(0, _env_int("FREE_TRIAL_CARDS_TOTAL", 25))


def demo_billing_controls_enabled():
    if not is_production():
        return _env_bool("ENABLE_DEMO_BILLING_CONTROLS", True)
    return _env_bool("ENABLE_DEMO_BILLING_CONTROLS", False)


def _master_user_emails():
    raw = os.environ.get("MASTER_USER_EMAILS", "")
    return {x.strip().lower() for x in raw.split(",") if x.strip()}


def is_master_user(*, account_email=None):
    email = (account_email or "").strip().lower()
    if not email:
        return False
    return email in _master_user_emails()


def account_state(models_module, db_path, *, account_id, account_email=None, ensure_default=True):
    if ensure_default:
        models_module.ensure_subscription(
            db_path,
            account_id,
            account_email=account_email,
            status=("trialing" if free_trial_enabled() else "no_subscription"),
            plan_name=("Starter Trial" if free_trial_enabled() else "No Plan"),
            cards_per_month_limit=200,
            trial_cards_total_limit=free_trial_cards_total(),
        )
    elif account_email:
        existing = models_module.get_subscription(db_path, account_id)
        if existing and existing.get("account_email") != account_email:
            models_module.set_subscription(db_path, account_id, account_email=account_email, status=existing["status"])
    sub = models_module.get_subscription(db_path, account_id) or {
        "account_id": account_id,
        "account_email": account_email,
        "status": "no_subscription",
        "plan_name": "No Plan",
        "cards_per_month_limit": 0,
        "trial_cards_total_limit": free_trial_cards_total(),
        "trial_exhausted_at": None,
        "stripe_customer_id": None,
        "stripe_subscription_id": None,
    }
    if account_email and sub.get("account_email") != account_email:
        models_module.set_subscription(
            db_path,
            account_id,
            account_email=account_email,
            status=sub.get("status") or "trialing",
            plan_name=sub.get("plan_name"),
            cards_per_month_limit=sub.get("cards_per_month_limit"),
            stripe_customer_id=sub.get("stripe_customer_id"),
            stripe_subscription_id=sub.get("stripe_subscription_id"),
            trial_cards_total_limit=sub.get("trial_cards_total_limit"),
            trial_exhausted_at=sub.get("trial_exhausted_at"),
        )
        sub["account_email"] = account_email
    current_month = month_key()
    used_cards = models_module.usage_cards_for_month(db_path, account_id, current_month)
    lifetime_used_cards = models_module.usage_cards_lifetime(db_path, account_id)
    limit_cards = int(sub.get("cards_per_month_limit") or 0)
    trial_total_limit = int(sub.get("trial_cards_total_limit") or 0)
    remaining_cards = max(0, limit_cards - used_cards) if limit_cards > 0 else 0
    trial_remaining_cards = max(0, trial_total_limit - lifetime_used_cards) if trial_total_limit > 0 else 0
    trial_exhausted = bool(trial_total_limit > 0 and lifetime_used_cards >= trial_total_limit)
    status = sub.get("status")
    can_process = status in ALLOWED_PROCESSING_STATUSES and (limit_cards <= 0 or remaining_cards > 0)
    if status == "trialing":
        can_process = (trial_total_limit <= 0) or (trial_remaining_cards > 0)
    usage_ratio = 0
    if status == "trialing" and trial_total_limit > 0:
        usage_ratio = max(0, min(100, int(round((lifetime_used_cards / trial_total_limit) * 100))))
    elif limit_cards > 0:
        usage_ratio = max(0, min(100, int(round((used_cards / limit_cards) * 100))))
    state = {
        "account_id": account_id,
        "account_email": sub.get("account_email") or account_email,
        "status": sub.get("status", "no_subscription"),
        "status_label": status_label(sub.get("status")),
        "plan_name": sub.get("plan_name", "No Plan"),
        "cards_limit": limit_cards,
        "used_cards": used_cards,
        "remaining_cards": remaining_cards,
        "usage_ratio": usage_ratio,
        "month_key": current_month,
        "can_process": can_process,
        "stripe_customer_id": sub.get("stripe_customer_id"),
        "stripe_subscription_id": sub.get("stripe_subscription_id"),
        "is_trial_user": status == "trialing",
        "trial_cards_total_limit": trial_total_limit,
        "trial_used_cards_total": lifetime_used_cards,
        "trial_remaining_cards": trial_remaining_cards,
        "trial_exhausted": trial_exhausted,
        "upgrade_required": bool(status == "trialing" and trial_exhausted),
    }
    if is_master_user(account_email=state.get("account_email")):
        state.update(
            {
                "is_master_user": True,
                "status": "active",
                "status_label": "Owner (Bypass)",
                "plan_name": "Owner Access",
                "cards_limit": 0,  # 0 means unlimited in existing gating logic.
                "remaining_cards": 0,
                "usage_ratio": 0,
                "can_process": True,
            }
        )
    else:
        state["is_master_user"] = False
    return state


def local_account_state(models_module, db_path):
    return account_state(models_module, db_path, account_id="local", ensure_default=True)


def can_start_batch(account_state, requested_cards):
    requested_cards = int(requested_cards or 0)
    if account_state.get("is_master_user"):
        return True, ""
    if account_state.get("status") == "trialing":
        trial_limit = int(account_state.get("trial_cards_total_limit") or 0)
        used_total = int(account_state.get("trial_used_cards_total") or 0)
        if trial_limit > 0 and used_total + requested_cards > trial_limit:
            remaining = max(0, trial_limit - used_total)
            return False, (
                f"This batch exceeds your free trial ({used_total}/{trial_limit} cards used). "
                f"Remaining trial cards: {remaining}. Upgrade to continue."
            )
    status = account_state.get("status")
    if status in BLOCKED_STATUSES:
        return False, _blocked_status_message(status)
    if status not in ALLOWED_PROCESSING_STATUSES:
        return False, "An active plan is required to start processing."
    limit_cards = int(account_state.get("cards_limit") or 0)
    used_cards = int(account_state.get("used_cards") or 0)
    if limit_cards > 0 and used_cards + requested_cards > limit_cards:
        remaining = max(0, limit_cards - used_cards)
        return False, (
            f"This batch would exceed your monthly limit ({used_cards}/{limit_cards} cards used). "
            f"Remaining this month: {remaining} cards."
        )
    return True, ""


def _blocked_status_message(status):
    return {
        "past_due": "Your subscription payment is past due. Update billing to resume processing.",
        "canceled": "Your subscription is canceled. Upgrade to resume processing.",
        "incomplete": "Finish checkout to start processing.",
        "no_subscription": "Start a subscription or trial to begin processing batches.",
    }.get(status, "An active plan is required to start processing.")


def maybe_record_batch_usage(models_module, db_path, job_snapshot):
    if not job_snapshot:
        return
    if job_snapshot.get("status") not in {"completed", "completed_with_warnings"}:
        return
    models_module.record_usage_for_batch(
        db_path,
        account_id=job_snapshot.get("owner_id", "local"),
        batch_id=job_snapshot.get("id"),
        cards_processed=int(job_snapshot.get("total_cards", 0) or 0),
        created_at=job_snapshot.get("finished_at") or job_snapshot.get("created_at"),
    )


def verify_stripe_signature(payload_bytes, signature_header, secret, tolerance_seconds=300):
    if not secret and is_production():
        return False, "webhook-secret-required-in-production"
    if not secret:
        return True, "no-secret-configured"
    if not signature_header:
        return False, "missing-signature"
    parts = {}
    for part in signature_header.split(","):
        if "=" not in part:
            continue
        k, v = part.split("=", 1)
        parts.setdefault(k.strip(), []).append(v.strip())
    ts_values = parts.get("t") or []
    sig_values = parts.get("v1") or []
    if not ts_values or not sig_values:
        return False, "invalid-signature-header"
    try:
        timestamp = int(ts_values[0])
    except Exception:
        return False, "invalid-timestamp"
    now_ts = int(datetime.now().timestamp())
    if abs(now_ts - timestamp) > int(tolerance_seconds):
        return False, "signature-timestamp-expired"
    signed_payload = f"{timestamp}.{payload_bytes.decode('utf-8')}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    for candidate in sig_values:
        if hmac.compare_digest(expected, candidate):
            return True, "ok"
    return False, "signature-mismatch"


def parse_json_event(payload_bytes):
    return json.loads(payload_bytes.decode("utf-8"))


def apply_stripe_event_to_subscription(models_module, db_path, event):
    event_type = event.get("type") or ""
    data_object = (((event.get("data") or {}).get("object")) or {})

    if event_type in {"customer.subscription.created", "customer.subscription.updated"}:
        stripe_status = (data_object.get("status") or "").lower()
        app_status = _map_stripe_subscription_status(stripe_status)
        plan_name = (
            ((data_object.get("items") or {}).get("data") or [{}])[0]
            .get("price", {})
            .get("nickname")
            or "Photo Prep Pro"
        )
        limit = None
        metadata = data_object.get("metadata") or {}
        raw_limit = metadata.get("cards_per_month_limit")
        if raw_limit is not None:
            try:
                limit = int(raw_limit)
            except Exception:
                limit = None
        stripe_customer_id = data_object.get("customer")
        stripe_subscription_id = data_object.get("id")
        metadata_account_id = metadata.get("account_id")
        sub = models_module.get_subscription_by_stripe_customer(db_path, stripe_customer_id)
        if not sub and stripe_subscription_id:
            sub = models_module.get_subscription_by_stripe_subscription(db_path, stripe_subscription_id)
        account_id = (sub or {}).get("account_id") or metadata_account_id or "local"
        account_email = (sub or {}).get("account_email") or metadata.get("account_email")
        models_module.set_subscription(
            db_path,
            account_id,
            account_email=account_email,
            status=app_status,
            plan_name=plan_name,
            cards_per_month_limit=limit if limit is not None else None,
            stripe_customer_id=stripe_customer_id,
            stripe_subscription_id=stripe_subscription_id,
        )
        return {"updated": True, "status": app_status, "source": event_type}

    if event_type == "customer.subscription.deleted":
        stripe_customer_id = data_object.get("customer")
        stripe_subscription_id = data_object.get("id")
        sub = models_module.get_subscription_by_stripe_customer(db_path, stripe_customer_id) or (
            models_module.get_subscription_by_stripe_subscription(db_path, stripe_subscription_id)
        )
        account_id = (sub or {}).get("account_id") or "local"
        models_module.set_subscription(
            db_path,
            account_id,
            account_email=(sub or {}).get("account_email"),
            status="canceled",
            stripe_customer_id=stripe_customer_id,
            stripe_subscription_id=stripe_subscription_id,
        )
        return {"updated": True, "status": "canceled", "source": event_type}

    if event_type == "checkout.session.completed":
        if (data_object.get("mode") or "") == "subscription":
            # Final status generally comes from customer.subscription.updated; keep this a no-op success.
            return {"updated": False, "status": "pending_subscription_event", "source": event_type}

    return {"updated": False, "status": "ignored", "source": event_type}


def apply_stripe_event_to_local_subscription(models_module, db_path, event):
    # Backward-compatible wrapper used by existing code paths.
    return apply_stripe_event_to_subscription(models_module, db_path, event)


def _map_stripe_subscription_status(stripe_status):
    return {
        "trialing": "trialing",
        "active": "active",
        "past_due": "past_due",
        "canceled": "canceled",
        "incomplete": "incomplete",
        "incomplete_expired": "incomplete",
        "unpaid": "past_due",
        "paused": "past_due",
    }.get(stripe_status, "past_due")


def stripe_config():
    return {
        "secret_key": os.environ.get("STRIPE_SECRET_KEY", ""),
        "price_id": os.environ.get("STRIPE_PRICE_ID", ""),
        "app_base_url": os.environ.get("APP_BASE_URL", ""),
    }


def stripe_checkout_ready():
    cfg = stripe_config()
    return bool(cfg["secret_key"] and cfg["price_id"] and cfg["app_base_url"])


def stripe_portal_ready():
    cfg = stripe_config()
    return bool(cfg["secret_key"] and cfg["app_base_url"])


def create_checkout_session(account_state):
    cfg = stripe_config()
    if not stripe_checkout_ready():
        raise RuntimeError("Stripe checkout is not configured")
    success_url = cfg["app_base_url"].rstrip("/") + "/account?checkout=success"
    cancel_url = cfg["app_base_url"].rstrip("/") + "/account?checkout=canceled"
    form = [
        ("mode", "subscription"),
        ("success_url", success_url),
        ("cancel_url", cancel_url),
        ("line_items[0][price]", cfg["price_id"]),
        ("line_items[0][quantity]", "1"),
        ("allow_promotion_codes", "true"),
        ("metadata[account_id]", account_state["account_id"]),
    ]
    if account_state.get("account_email"):
        form.append(("customer_email", account_state["account_email"]))
        form.append(("metadata[account_email]", account_state["account_email"]))
    if account_state.get("stripe_customer_id"):
        # Prefer existing customer linkage for returning users.
        form = [x for x in form if x[0] != "customer_email"]
        form.append(("customer", account_state["stripe_customer_id"]))
    return _stripe_post_form("/v1/checkout/sessions", form, cfg["secret_key"])


def create_billing_portal_session(account_state):
    cfg = stripe_config()
    if not stripe_portal_ready():
        raise RuntimeError("Stripe billing portal is not configured")
    customer_id = account_state.get("stripe_customer_id")
    if not customer_id:
        raise RuntimeError("No Stripe customer is linked to this account yet")
    return_url = cfg["app_base_url"].rstrip("/") + "/account"
    form = [("customer", customer_id), ("return_url", return_url)]
    return _stripe_post_form("/v1/billing_portal/sessions", form, cfg["secret_key"])


def _stripe_post_form(path, fields, secret_key):
    body = urllib.parse.urlencode(fields).encode("utf-8")
    req = urllib.request.Request(
        "https://api.stripe.com" + path,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {secret_key}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
            data = json.loads(raw.decode("utf-8"))
            return data
    except Exception as exc:
        raise RuntimeError(f"Stripe API request failed: {exc}") from exc
