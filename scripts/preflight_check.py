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
    gumroad = importlib.import_module("photo_prep_app.services.gumroad")

    checks = []
    warnings = []

    def add_check(name, ok, details=""):
        checks.append({"name": name, "ok": bool(ok), "details": details})

    def add_warning(name, details=""):
        warnings.append({"name": name, "details": details})

    # Environment / mode
    app_env = (os.environ.get("APP_ENV") or "").strip().lower()
    add_check("app_env_set", bool(app_env), f"APP_ENV={os.environ.get('APP_ENV','')} (local/dev configs usually leave this unset)")
    add_check(
        "app_env_production_for_launch",
        (not auth_service.launch_mode_enabled()) or app_env == "production",
        f"APP_ENV={os.environ.get('APP_ENV','')} (launch config must be production)",
    )
    active_auth_mode = auth_service.auth_mode()
    add_check(
        "auth_mode",
        active_auth_mode in {"demo", "auth0", "gumroad"},
        f"AUTH_MODE={active_auth_mode} ({'supported' if active_auth_mode in {'demo', 'auth0', 'gumroad'} else 'unsupported'})",
    )
    add_check("secret_key_not_default", app_module.app.config.get("SECRET_KEY") != "local-dev-secret-change-me", "PHOTO_PREP_APP_SECRET must be non-default")
    add_check(
        "app_base_url_https_in_production",
        (not billing.is_production()) or str(getattr(app_module, "APP_BASE_URL", "")).lower().startswith("https://"),
        f"APP_BASE_URL={getattr(app_module, 'APP_BASE_URL', '')}",
    )
    add_check(
        "support_email_configured_for_launch",
        (not auth_service.launch_mode_enabled()) or auth_service.support_email_configured(),
        f"SUPPORT_EMAIL={auth_service.support_email()} (launch config requires a real monitored inbox)",
    )
    add_check(
        "legal_entity_configured_for_launch",
        (not auth_service.launch_mode_enabled()) or auth_service.legal_entity_configured(),
        f"LEGAL_ENTITY_NAME={auth_service.legal_entity_name()} (launch config requires the real business name)",
    )
    add_check(
        "legal_contact_address_configured_for_launch",
        (not auth_service.launch_mode_enabled()) or auth_service.legal_contact_address_configured(),
        f"LEGAL_CONTACT_ADDRESS={auth_service.legal_contact_address()} (launch config requires a real contact address)",
    )
    add_check("demo_billing_controls_disabled_in_production", (not billing.is_production()) or (not billing.demo_billing_controls_enabled()), f"enabled={billing.demo_billing_controls_enabled()}")

    # Auth / billing readiness
    add_check("auth0_ready_if_enabled", (auth_service.auth_mode() != "auth0") or auth_service.auth0_ready(), "AUTH0_* vars")
    add_check(
        "gumroad_launch_ready_if_enabled",
        (active_auth_mode != "gumroad") or gumroad.launch_ready(),
        "GUMROAD_PRODUCT_PERMALINK or GUMROAD_PRODUCT_ID for the real launch product",
    )
    add_check(
        "gumroad_purchase_link_ready_if_enabled",
        (active_auth_mode != "gumroad") or bool(auth_service.gumroad_product_url()),
        "GUMROAD_PRODUCT_URL or GUMROAD_PRODUCT_PERMALINK for the buyer-facing purchase link",
    )
    add_check(
        "stripe_checkout_ready_if_required",
        (active_auth_mode == "gumroad") or billing.stripe_checkout_ready(),
        "STRIPE_SECRET_KEY / STRIPE_PRICE_ID / APP_BASE_URL",
    )
    add_check(
        "stripe_portal_ready_if_required",
        (active_auth_mode == "gumroad") or billing.stripe_portal_ready(),
        "STRIPE_SECRET_KEY / APP_BASE_URL",
    )
    add_check(
        "stripe_webhook_secret_if_required",
        (active_auth_mode == "gumroad") or bool((os.environ.get("STRIPE_WEBHOOK_SECRET") or "").strip()),
        "STRIPE_WEBHOOK_SECRET",
    )

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

    try:
        runtime_warnings = app_module._readiness_warnings()
        for item in runtime_warnings:
            add_warning("readiness_warning", item)
    except Exception as exc:
        add_warning("readiness_warning_collection_failed", str(exc))

    failed = [c for c in checks if not c["ok"]]
    print(json.dumps({"ok": not failed, "checks": checks, "warnings": warnings}, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
