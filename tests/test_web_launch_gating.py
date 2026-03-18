import os
import tempfile
import unittest
from unittest import mock

from photo_prep_app import models
from photo_prep_app.services import billing
from photo_prep_app.app import app


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
