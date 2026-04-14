# Public Launch Checklist

Use this checklist for the current Gumroad-gated MVP launch.

## 1. Production config

- Copy `.env.production.example` to `.env` on the server.
- Set a real `PHOTO_PREP_APP_SECRET`.
- Set `APP_BASE_URL` to the public HTTPS origin.
- Set `SUPPORT_EMAIL` to a monitored inbox with an owner and response SLA.
- Set `LEGAL_ENTITY_NAME` and `LEGAL_CONTACT_ADDRESS` to the real business values.
- Set `AUTH_MODE=gumroad` and `LAUNCH_MODE=true`.
- Set `GUMROAD_PRODUCT_URL` or `GUMROAD_PRODUCT_PERMALINK`.
- Keep `ENABLE_DEMO_BILLING_CONTROLS=false`.

## 2. Server/runtime

- Install `tesseract-ocr`, HEIC runtime packages, and Python dependencies from `requirements-web.txt`.
- Confirm `_Web_Runs/` is writable.
- Confirm `photo_prep_app.db` initializes cleanly.
- Start Gunicorn with `gunicorn -c gunicorn.conf.py wsgi:application`.
- Keep the deployment at one app worker.
- Put the app behind HTTPS with a reverse proxy and a request-size limit that matches `MAX_CONTENT_LENGTH_MB`.

## 3. Launch evidence

- Add at least one real 48 MP HEIC batch under `qa/assets/heic/`.
- Run the Chromium profiling flow from `qa/checks/worker_profile_plan.md`.
- Run `qa/checks/export_validation.py` against both directory and ZIP exports.
- Save a production `/readiness` artifact with `python3 scripts/capture_readiness.py --base-url https://your-domain.com`.
- Save one clean web build log using `cd web && npm ci && npm run build`.
- Attach the HEIC sample source, trace files, and export-validation output to `qa/reports/mvp-readout.md`.

## 4. Final verification

- Run `python3 scripts/preflight_check.py` on the production server and require `"ok": true`.
- Verify `GET /healthz` returns `{"ok":true}`.
- Verify `GET /readiness` returns `"ok": true` and review any warnings.
- Execute the buyer flow in `docs/launch/SMOKE_TEST.md`.
- Run `python3 scripts/backup_db.py --label prelaunch` and confirm the backup file exists.
- Build the release archive with `python3 scripts/package_release.py --label prelaunch`.

## 5. Launch-day ops

- Monitor the support inbox during launch.
- Keep the latest DB backup path recorded.
- Keep rollback instructions and incident steps from `docs/launch/OPS_RUNBOOK.md` available.
