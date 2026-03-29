import os
import tempfile
import unittest
from unittest import mock
import importlib

from photo_prep_app import models
from photo_prep_app.services import billing
from photo_prep_app.app import app

app_module = importlib.import_module("photo_prep_app.app")


class TestWebLaunchGating(unittest.TestCase):
    def test_trial_one_time_limit_blocks_overage(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test.db")
            models.init_db(db_path)
            with mock.patch.dict(os.environ, {"FREE_TRIAL_ENABLED": "1", "FREE_TRIAL_CARDS_TOTAL": "5"}, clear=False):
                acct = billing.account_state(models, db_path, account_id="u1", account_email="u1@example.com")
                self.assertTrue(acct["is_trial_user"])
                self.assertEqual(acct["trial_cards_total_limit"], 5)
                models.record_usage_for_batch(db_path, account_id="u1", batch_id="b1", cards_processed=4)
                acct = billing.account_state(models, db_path, account_id="u1", account_email="u1@example.com")
                allowed, _ = billing.can_start_batch(acct, requested_cards=1)
                self.assertTrue(allowed)
                allowed, msg = billing.can_start_batch(acct, requested_cards=2)
                self.assertFalse(allowed)
                self.assertIn("free trial", msg.lower())

    def test_master_user_bypass_overrides_billing_state(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test.db")
            models.init_db(db_path)
            email = "owner@example.com"
            with mock.patch.dict(os.environ, {"MASTER_USER_EMAILS": email}, clear=False):
                models.ensure_subscription(db_path, "owner-1", account_email=email, status="past_due", plan_name="Nope", cards_per_month_limit=0)
                acct = billing.account_state(models, db_path, account_id="owner-1", account_email=email)
                self.assertTrue(acct["is_master_user"])
                self.assertTrue(acct["can_process"])
                allowed, _ = billing.can_start_batch(acct, requested_cards=9999)
                self.assertTrue(allowed)

    def test_demo_billing_controls_disabled_in_production_by_default(self):
        with mock.patch.dict(os.environ, {"APP_ENV": "production"}, clear=False):
            self.assertFalse(billing.demo_billing_controls_enabled())

    def test_enqueue_requires_csrf(self):
        client = app.test_client()
        with client.session_transaction() as sess:
            sess["auth_user"] = {"id": "u1", "email": "u1@example.com", "provider": "demo"}
            sess["csrf_token"] = "expected"
        resp = client.post("/enqueue", data={})
        self.assertEqual(resp.status_code, 400)
        self.assertIn(b"Security check failed", resp.data)

    def test_workspace_redirects_anonymous_users_to_license_login(self):
        client = app.test_client()
        resp = client.get("/workspace", follow_redirects=False)
        self.assertEqual(resp.status_code, 302)
        self.assertIn("/login?next=/workspace", resp.headers["Location"])

    def test_legal_pages_load(self):
        client = app.test_client()
        self.assertEqual(client.get("/privacy").status_code, 200)
        self.assertEqual(client.get("/terms").status_code, 200)

    def test_readiness_flags_missing_launch_contact_and_purchase_link(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "test.db")
            models.init_db(db_path)
            old_secret = app_module.app.config.get("SECRET_KEY")
            app_module.app.config["SECRET_KEY"] = "not-default"
            try:
                with mock.patch.object(app_module, "DB_PATH", db_path), mock.patch.object(app_module, "RUNS_ROOT", tmpdir), mock.patch.object(
                    app_module, "APP_BASE_URL", "https://cardworks.example.com"
                ), mock.patch.object(
                    app_module.shutil, "which", return_value="/usr/bin/tesseract"
                ), mock.patch.dict(
                    os.environ,
                    {
                        "APP_ENV": "production",
                        "AUTH_MODE": "gumroad",
                        "LAUNCH_MODE": "true",
                        "SUPPORT_EMAIL": "support@cardworks.app",
                        "GUMROAD_PRODUCT_ID": "prod_123",
                        "GUMROAD_PRODUCT_URL": "",
                        "GUMROAD_PRODUCT_PERMALINK": "",
                    },
                    clear=False,
                ):
                    issues = app_module._readiness_issues()
            finally:
                app_module.app.config["SECRET_KEY"] = old_secret

        self.assertTrue(any("SUPPORT_EMAIL" in item for item in issues))
        self.assertTrue(any("purchase link" in item for item in issues))

    def test_readiness_endpoint_includes_warnings(self):
        client = app.test_client()
        old_secret = app_module.app.config.get("SECRET_KEY")
        app_module.app.config["SECRET_KEY"] = "not-default"
        try:
            with tempfile.TemporaryDirectory() as tmpdir, mock.patch.object(app_module, "RUNS_ROOT", tmpdir), mock.patch.object(
                app_module, "DB_PATH", os.path.join(tmpdir, "test.db")
            ), mock.patch.object(
                app_module, "APP_BASE_URL", "https://cardworks.example.com"
            ), mock.patch.object(
                app_module.shutil, "which", return_value="/usr/bin/tesseract"
            ), mock.patch.dict(
                os.environ,
                {
                    "APP_ENV": "production",
                    "AUTH_MODE": "gumroad",
                    "LAUNCH_MODE": "true",
                    "SUPPORT_EMAIL": "help@example.com",
                    "GUMROAD_PRODUCT_PERMALINK": "cardworks-live",
                    "GUMROAD_PRODUCT_URL": "https://gumroad.com/l/cardworks-live",
                    "SENTRY_DSN": "",
                    "PLAUSIBLE_DOMAIN": "",
                },
                clear=False,
            ):
                models.init_db(app_module.DB_PATH)
                resp = client.get("/readiness")
        finally:
            app_module.app.config["SECRET_KEY"] = old_secret

        self.assertEqual(resp.status_code, 200)
        self.assertIn(b'"warnings"', resp.data)
        self.assertIn(b'SENTRY_DSN', resp.data)
        self.assertIn(b'PLAUSIBLE_DOMAIN', resp.data)

    def test_privacy_page_uses_configured_business_values(self):
        client = app.test_client()
        with mock.patch.dict(
            os.environ,
            {
                "APP_DISPLAY_NAME": "CardWorks Pro",
                "LEGAL_ENTITY_NAME": "CardWorks LLC",
                "LEGAL_CONTACT_ADDRESS": "123 Main St",
                "SUPPORT_EMAIL": "privacy@example.com",
            },
            clear=False,
        ):
            resp = client.get("/privacy")

        self.assertEqual(resp.status_code, 200)
        self.assertIn(b"CardWorks LLC", resp.data)
        self.assertIn(b"CardWorks Pro", resp.data)
        self.assertIn(b"123 Main St", resp.data)
        self.assertIn(b"privacy@example.com", resp.data)


if __name__ == "__main__":
    unittest.main(verbosity=2)
