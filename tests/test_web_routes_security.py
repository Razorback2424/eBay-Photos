import os
import tempfile
import unittest
from io import BytesIO
from unittest import mock

import importlib

import cv2
import numpy as np


app_module = importlib.import_module("photo_prep_app.app")
models = importlib.import_module("photo_prep_app.models")


class TestWebRouteSecurity(unittest.TestCase):
    def setUp(self):
        app_module.THROTTLE_EVENTS.clear()
        with app_module.JOB_LOCK:
            app_module.JOBS.clear()

    def _login_session(self, client, user_id="u1", email="u1@example.com"):
        with client.session_transaction() as sess:
            sess["auth_user"] = {"id": user_id, "email": email, "provider": "demo"}
            sess["csrf_token"] = "test-csrf"

    def _upsert_batch(self, db_path, batch_id, owner_id, status, run_dir=None, cards_root=None, zip_path=None):
        models.upsert_batch_from_job(
            db_path,
            {
                "id": batch_id,
                "owner_id": owner_id,
                "owner_email": f"{owner_id}@example.com",
                "batch_name": "test",
                "status": status,
                "mode": "fast",
                "created_at": "2026-02-24T12:00:00",
                "started_at": "2026-02-24T12:00:01",
                "finished_at": "2026-02-24T12:00:02" if status not in {"queued", "running"} else None,
                "error": None,
                "run_dir": run_dir,
                "cards_root": cards_root,
                "zip_path": zip_path,
                "pair_count": 1,
                "processed_pairs": 1 if status not in {"queued", "running"} else 0,
                "total_cards": 1 if status in {"completed", "completed_with_warnings", "expired"} else 0,
                "total_images": 10 if status in {"completed", "completed_with_warnings", "expired"} else 0,
                "output_warnings": "",
                "pair_results": [],
            },
        )

    def test_user_cannot_access_other_users_batch(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "app.db")
            models.init_db(db_path)
            self._upsert_batch(db_path, "b1", "owner-a", "completed")
            client = app_module.app.test_client()
            self._login_session(client, user_id="owner-b", email="b@example.com")
            with mock.patch.object(app_module, "DB_PATH", db_path):
                r = client.get("/batches/b1")
            self.assertEqual(r.status_code, 404)

    def test_download_blocked_for_queued_running_failed(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "app.db")
            models.init_db(db_path)
            client = app_module.app.test_client()
            self._login_session(client, user_id="u1")
            with mock.patch.object(app_module, "DB_PATH", db_path), mock.patch.object(app_module, "RUNS_ROOT", tmpdir):
                for status in ("queued", "running", "failed"):
                    batch_id = f"job-{status}"
                    self._upsert_batch(db_path, batch_id, "u1", status, run_dir=os.path.join(tmpdir, batch_id))
                    r = client.get(f"/download/{batch_id}")
                    self.assertEqual(r.status_code, 404, status)
                    self.assertIn(b"Download", r.data)

    def test_download_and_preview_blocked_for_expired(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "app.db")
            models.init_db(db_path)
            run_dir = os.path.join(tmpdir, "job-expired")
            cards_root = os.path.join(run_dir, "cards")
            card_dir = os.path.join(cards_root, "pair-0001", "Card_0001")
            os.makedirs(card_dir, exist_ok=True)
            img_path = os.path.join(card_dir, "Card_0001_FRONT.jpg")
            with open(img_path, "wb") as fh:
                fh.write(b"\xff\xd8\xff\xd9")
            zip_path = os.path.join(run_dir, "cards_bundle.zip")
            with open(zip_path, "wb") as fh:
                fh.write(b"PK\x03\x04")

            self._upsert_batch(db_path, "job-expired", "u1", "expired", run_dir=run_dir, cards_root=cards_root, zip_path=zip_path)
            client = app_module.app.test_client()
            self._login_session(client, user_id="u1")
            with mock.patch.object(app_module, "DB_PATH", db_path), mock.patch.object(app_module, "RUNS_ROOT", tmpdir):
                r_download = client.get("/download/job-expired")
                self.assertEqual(r_download.status_code, 404)
                self.assertIn(b"expired", r_download.data.lower())

                rel = "pair-0001/Card_0001/Card_0001_FRONT.jpg"
                r_preview = client.get(f"/preview/job-expired/{rel}")
                self.assertEqual(r_preview.status_code, 404)
                self.assertIn(b"expired", r_preview.data.lower())

    def test_startup_recovery_marks_incomplete_batches_failed(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "app.db")
            models.init_db(db_path)
            self._upsert_batch(db_path, "b-queued", "u1", "queued")
            self._upsert_batch(db_path, "b-running", "u1", "running")
            models.mark_incomplete_batches_failed_on_startup(db_path)
            q = models.get_batch(db_path, "b-queued", owner_id="u1")
            r = models.get_batch(db_path, "b-running", owner_id="u1")
            self.assertEqual(q["status"], "failed")
            self.assertEqual(r["status"], "failed")
            self.assertIn("re-run", (q.get("error") or "").lower())

    def test_enqueue_accepts_png_uploads(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "app.db")
            models.init_db(db_path)
            _, encoded = cv2.imencode(".png", np.zeros((8, 8, 3), dtype=np.uint8))
            png_bytes = encoded.tobytes()

            client = app_module.app.test_client()
            self._login_session(client, user_id="u1")
            with mock.patch.object(app_module, "DB_PATH", db_path), mock.patch.object(
                app_module, "RUNS_ROOT", tmpdir
            ), mock.patch.object(app_module.JOB_QUEUE, "put") as queue_put, mock.patch.dict(
                os.environ,
                {
                    "AUTH_MODE": "gumroad",
                    "LAUNCH_MODE": "true",
                },
                clear=False,
            ):
                resp = client.post(
                    "/enqueue",
                    data={
                        "csrf_token": "test-csrf",
                        "front_files": (BytesIO(png_bytes), "front.png"),
                        "back_files": (BytesIO(png_bytes), "back.PNG"),
                    },
                    content_type="multipart/form-data",
                )

            self.assertEqual(resp.status_code, 302)
            self.assertIn("/job/", resp.headers["Location"])
            queue_put.assert_called_once()

    def test_debug_log_panel_disabled_in_production(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "app.db")
            models.init_db(db_path)
            self._upsert_batch(db_path, "b1", "u1", "completed")
            client = app_module.app.test_client()
            self._login_session(client, user_id="u1")
            with mock.patch.object(app_module, "DB_PATH", db_path), mock.patch.dict(os.environ, {"APP_ENV": "production"}, clear=False):
                r = client.get("/batches/b1?debug=1")
            self.assertEqual(r.status_code, 200)
            self.assertNotIn(b"Debug Log", r.data)

    def test_gumroad_login_accepts_test_license_key_and_shows_onboarding(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            db_path = os.path.join(tmpdir, "app.db")
            models.init_db(db_path)
            client = app_module.app.test_client()
            with mock.patch.object(app_module, "DB_PATH", db_path), mock.patch.dict(
                os.environ,
                {
                    "AUTH_MODE": "gumroad",
                    "GUMROAD_TEST_LICENSE_KEYS": "TEST-KEY-123",
                    "LAUNCH_MODE": "true",
                },
                clear=False,
            ):
                get_resp = client.get("/login")
                self.assertEqual(get_resp.status_code, 200)
                with client.session_transaction() as sess:
                    csrf_token = sess["csrf_token"]
                post_resp = client.post(
                    "/login",
                    data={
                        "email": "buyer@example.com",
                        "license_key": "TEST-KEY-123",
                        "csrf_token": csrf_token,
                        "next": "/workspace",
                    },
                    follow_redirects=True,
                )
            self.assertEqual(post_resp.status_code, 200)
            self.assertIn(b"First batch", post_resp.data)
            self.assertIn(b"buyer@example.com", post_resp.data)

    def test_gumroad_login_rejects_invalid_license_key(self):
        client = app_module.app.test_client()
        with mock.patch.dict(
            os.environ,
            {
                "AUTH_MODE": "gumroad",
                "GUMROAD_TEST_LICENSE_KEYS": "VALID-KEY",
                "LAUNCH_MODE": "true",
            },
            clear=False,
        ), mock.patch.object(
            app_module.gumroad_service,
            "verify_license",
            return_value=(False, "That license key was not accepted. Check the receipt and try again."),
        ):
            get_resp = client.get("/login")
            self.assertEqual(get_resp.status_code, 200)
            with client.session_transaction() as sess:
                csrf_token = sess["csrf_token"]
            post_resp = client.post(
                "/login",
                data={
                    "email": "buyer@example.com",
                    "license_key": "WRONG-KEY",
                    "csrf_token": csrf_token,
                    "next": "/workspace",
                },
            )
        self.assertEqual(post_resp.status_code, 400)
        self.assertIn(b"not accepted", post_resp.data)

    def test_account_launch_mode_hides_demo_admin_panels(self):
        client = app_module.app.test_client()
        self._login_session(client, user_id="gumroad-1", email="buyer@example.com")
        with mock.patch.dict(
            os.environ,
            {
                "AUTH_MODE": "gumroad",
                "LAUNCH_MODE": "true",
                "ENABLE_DEMO_BILLING_CONTROLS": "1",
            },
            clear=False,
        ):
            resp = client.get("/account")
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn(b"Local Testing Controls", resp.data)
        self.assertNotIn(b"Admin / Launch Setup", resp.data)
        self.assertNotIn(b"Demo/Unconfigured", resp.data)

    def test_security_headers_present_on_html_and_json(self):
        client = app_module.app.test_client()
        html_resp = client.get("/")
        json_resp = client.get("/healthz")

        for resp in (html_resp, json_resp):
            self.assertEqual(resp.headers["X-Content-Type-Options"], "nosniff")
            self.assertEqual(resp.headers["X-Frame-Options"], "DENY")
            self.assertEqual(resp.headers["Referrer-Policy"], "strict-origin-when-cross-origin")
            self.assertIn("default-src 'self'", resp.headers["Content-Security-Policy"])
            self.assertIn("frame-ancestors 'none'", resp.headers["Content-Security-Policy"])

    def test_login_rate_limit_returns_429(self):
        client = app_module.app.test_client()
        with mock.patch.object(app_module, "LOGIN_RATE_LIMIT", (1, 900)), mock.patch.dict(
            os.environ,
            {
                "AUTH_MODE": "gumroad",
                "LAUNCH_MODE": "true",
            },
            clear=False,
        ), mock.patch.object(
            app_module.gumroad_service,
            "verify_license",
            return_value=(False, "That license key was not accepted. Check the receipt and try again."),
        ):
            get_resp = client.get("/login")
            self.assertEqual(get_resp.status_code, 200)
            with client.session_transaction() as sess:
                csrf_token = sess["csrf_token"]
            first = client.post(
                "/login",
                data={"email": "buyer@example.com", "license_key": "bad-key", "csrf_token": csrf_token, "next": "/workspace"},
            )
            second = client.post(
                "/login",
                data={"email": "buyer@example.com", "license_key": "bad-key", "csrf_token": csrf_token, "next": "/workspace"},
            )
        self.assertEqual(first.status_code, 400)
        self.assertEqual(second.status_code, 429)
        self.assertIn(b"Too many login attempts", second.data)

    def test_webhook_rate_limit_returns_429(self):
        client = app_module.app.test_client()
        payload = b'{"id":"evt_1","type":"checkout.session.completed","data":{"object":{"mode":"subscription"}}}'
        with mock.patch.object(app_module, "STRIPE_WEBHOOK_RATE_LIMIT", (1, 60)), mock.patch.dict(
            os.environ,
            {"APP_ENV": "development", "STRIPE_WEBHOOK_SECRET": ""},
            clear=False,
        ):
            first = client.post("/webhooks/stripe", data=payload, headers={"Content-Type": "application/json"})
            second = client.post("/webhooks/stripe", data=payload, headers={"Content-Type": "application/json"})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)
        self.assertIn(b"Too many webhook requests", second.data)

    def test_webhook_uses_runtime_secret_from_environment(self):
        client = app_module.app.test_client()
        payload = b'{"id":"evt_secret","type":"checkout.session.completed","data":{"object":{"mode":"subscription"}}}'
        with mock.patch.dict(os.environ, {"APP_ENV": "production", "STRIPE_WEBHOOK_SECRET": ""}, clear=False):
            resp = client.post("/webhooks/stripe", data=payload, headers={"Content-Type": "application/json"})
        self.assertEqual(resp.status_code, 400)
        self.assertIn(b"webhook-secret-required-in-production", resp.data)

    def test_enqueue_rate_limit_returns_429(self):
        client = app_module.app.test_client()
        self._login_session(client, user_id="u1")
        with mock.patch.object(app_module, "ENQUEUE_RATE_LIMIT", (1, 300)):
            first = client.post("/enqueue", data={})
            second = client.post("/enqueue", data={})
        self.assertEqual(first.status_code, 400)
        self.assertEqual(second.status_code, 429)
        self.assertIn(b"Too many batch submissions", second.data)


if __name__ == "__main__":
    unittest.main(verbosity=2)
