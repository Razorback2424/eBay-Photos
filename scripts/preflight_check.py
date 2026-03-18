#!/usr/bin/env python3
import importlib
import json
import os
import shutil
import sys

PROJECT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if PROJECT_DIR not in sys.path:
    sys.path.insert(0, PROJECT_DIR)


def main():
    app_module = importlib.import_module("photo_prep_app.app")
    models = importlib.import_module("photo_prep_app.models")
    billing = importlib.import_module("photo_prep_app.services.billing")
    auth_service = importlib.import_module("photo_prep_app.services.auth")

    checks = []

    def add_check(name, ok, details=""):
        checks.append({"name": name, "ok": bool(ok), "details": details})

    # Environment / mode
    add_check("app_env_set", bool(os.environ.get("APP_ENV")), f"APP_ENV={os.environ.get('APP_ENV','')}")
    active_auth_mode = auth_service.auth_mode()
    add_check(
        "auth_mode",
        active_auth_mode in {"demo", "auth0", "gumroad"},
        f"AUTH_MODE={active_auth_mode} ({'supported' if active_auth_mode in {'demo', 'auth0', 'gumroad'} else 'unsupported'})",
    )
    add_check("secret_key_not_default", app_module.app.config.get("SECRET_KEY") != "local-dev-secret-change-me", "PHOTO_PREP_APP_SECRET must be non-default")
    add_check("demo_billing_controls_disabled_in_production", (not billing.is_production()) or (not billing.demo_billing_controls_enabled()), f"enabled={billing.demo_billing_controls_enabled()}")

    # Auth / billing readiness
    add_check("auth0_ready_if_enabled", (auth_service.auth_mode() != "auth0") or auth_service.auth0_ready(), "AUTH0_* vars")
    add_check("stripe_checkout_ready", billing.stripe_checkout_ready(), "STRIPE_SECRET_KEY / STRIPE_PRICE_ID / APP_BASE_URL")
    add_check("stripe_portal_ready", billing.stripe_portal_ready(), "STRIPE_SECRET_KEY / APP_BASE_URL")
    add_check("stripe_webhook_secret", bool((os.environ.get("STRIPE_WEBHOOK_SECRET") or "").strip()), "STRIPE_WEBHOOK_SECRET")

    # Runtime dependencies
    add_check("tesseract_on_path", shutil.which("tesseract") is not None, shutil.which("tesseract") or "not found")

    # Filesystem / DB
    try:
        os.makedirs(app_module.RUNS_ROOT, exist_ok=True)
        test_path = os.path.join(app_module.RUNS_ROOT, ".preflight_write_test")
        with open(test_path, "w", encoding="utf-8") as fh:
            fh.write("ok")
        os.remove(test_path)
        add_check("runs_root_writable", True, app_module.RUNS_ROOT)
    except Exception as exc:
        add_check("runs_root_writable", False, str(exc))

    try:
        models.init_db(app_module.DB_PATH)
        add_check("db_health", models.health_check(app_module.DB_PATH), app_module.DB_PATH)
    except Exception as exc:
        add_check("db_health", False, str(exc))

    # App readiness endpoint logic (without making HTTP request)
    try:
        issues = app_module._readiness_issues()
        add_check("app_readiness_issues_empty", len(issues) == 0, "; ".join(issues) if issues else "ok")
    except Exception as exc:
        add_check("app_readiness_issues_empty", False, str(exc))

    failed = [c for c in checks if not c["ok"]]
    print(json.dumps({"ok": not failed, "checks": checks}, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
