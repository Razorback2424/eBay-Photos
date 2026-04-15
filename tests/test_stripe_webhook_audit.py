import hashlib
import json
import os
import tempfile
import unittest
from unittest import mock

import importlib


app_module = importlib.import_module("photo_prep_app.app")
models = importlib.import_module("photo_prep_app.models")


class TestStripeWebhookAudit(unittest.TestCase):
    def _count_webhook_events(self, db_path):
        import sqlite3
        conn = sqlite3.connect(db_path)
        try:
            row = conn.execute("SELECT COUNT(*) FROM webhook_events").fetchone()
            return int(row[0] or 0)
        finally:
            conn.close()

    def test_duplicate_webhook_event_is_ignored_after_first_process(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "app.db")
            models.init_db(db_path)
            client = app_module.app.test_client()
            event = {
                "id": "evt_test_123",
                "type": "checkout.session.completed",
                "data": {"object": {"mode": "subscription"}},
            }
            payload = json.dumps(event).encode("utf-8")
            with mock.patch.object(app_module, "DB_PATH", db_path), mock.patch.dict(os.environ, {"STRIPE_WEBHOOK_SECRET": ""}, clear=False):
                r1 = client.post("/webhooks/stripe", data=payload, headers={"Content-Type": "application/json"})
                self.assertEqual(r1.status_code, 200)
                self.assertIn(b'"received":true', r1.data)

                r2 = client.post("/webhooks/stripe", data=payload, headers={"Content-Type": "application/json"})
                self.assertEqual(r2.status_code, 200)
                self.assertIn(b'"duplicate":true', r2.data)

            self.assertEqual(self._count_webhook_events(db_path), 1)

    def test_webhook_receipt_records_payload_hash(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "app.db")
            models.init_db(db_path)
            client = app_module.app.test_client()
            event = {
                "id": "evt_hash_1",
                "type": "checkout.session.completed",
                "data": {"object": {"mode": "subscription"}},
            }
            payload = json.dumps(event).encode("utf-8")
            expected_hash = hashlib.sha256(payload).hexdigest()
            with mock.patch.object(app_module, "DB_PATH", db_path), mock.patch.dict(os.environ, {"STRIPE_WEBHOOK_SECRET": ""}, clear=False):
                r = client.post("/webhooks/stripe", data=payload, headers={"Content-Type": "application/json"})
                self.assertEqual(r.status_code, 200)

            import sqlite3
            conn = sqlite3.connect(db_path)
            try:
                row = conn.execute(
                    "SELECT payload_sha256, processed_ok, status FROM webhook_events WHERE event_id = ?",
                    ("evt_hash_1",),
                ).fetchone()
                self.assertIsNotNone(row)
                self.assertEqual(row[0], expected_hash)
                self.assertEqual(int(row[1]), 1)
                self.assertTrue(row[2])
            finally:
                conn.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
