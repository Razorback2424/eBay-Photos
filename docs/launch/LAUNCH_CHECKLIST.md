# Public Launch Checklist

Use this checklist for the current Gumroad-gated MVP launch.

Read [launch_readiness.md](/Users/seankeller/Documents/eBay Photos/launch_readiness.md) first for the canonical launch gate, then [CONFIG_REFERENCE.md](/Users/seankeller/Documents/eBay Photos/docs/launch/CONFIG_REFERENCE.md) for concrete config rules. Local `.env` and checked-in examples are expected to fail readiness until real deployment values are supplied.

## 1. Production config

- Copy `.env.production.example` to `.env` on the server.
- Never commit valid secrets, live product IDs, or real support/legal data to `.env.production.example`.
- Replace every `REPLACE_IN_DEPLOYMENT_*` value before running preflight.
- Set a real `PHOTO_PREP_APP_SECRET`.
- Set `APP_BASE_URL` to the public HTTPS origin.
- Set `SUPPORT_EMAIL` to a monitored inbox with an owner and response SLA.
- Set `LEGAL_ENTITY_NAME` and `LEGAL_CONTACT_ADDRESS` to the real business values.
- Set `AUTH_MODE=gumroad` and `LAUNCH_MODE=true`.
- Set `GUMROAD_PRODUCT_URL` or `GUMROAD_PRODUCT_PERMALINK`.
- Confirm the one launch offer shown by CardWorks matches the price and billing terms on that Gumroad product.
- Replace both `REPLACE_WITH_*` tokens in `GUMROAD_CONFIRMATION_COPY.md` before publishing the receipt message.
- Keep `ENABLE_DEMO_BILLING_CONTROLS=false`.

## 2. Server/runtime

- Install `tesseract-ocr`, HEIC runtime packages, and Python dependencies from `requirements-web.txt`.
- Confirm `_Web_Runs/` is writable.
- Confirm `photo_prep_app.db` initializes cleanly.
- Start Gunicorn with `gunicorn -c gunicorn.conf.py wsgi:application`.
- Keep the deployment at one app worker.
- Put the app behind HTTPS with a reverse proxy and a request-size limit that matches `MAX_CONTENT_LENGTH_MB`.

## 3. Launch evidence

- Add real HEIC validation evidence for the supported launch scenarios under `qa/reports/launch-evidence/heic/`.
- Run the Chromium profiling flow from `qa/checks/worker_profile_plan.md` and save artifacts under `qa/reports/launch-evidence/performance/`.
- Run `qa/checks/export_validation.py` against both directory and ZIP exports and save the results under `qa/reports/launch-evidence/export-validation/`.
- Save production `/readiness` evidence with `python3 scripts/capture_readiness.py --base-url https://your-domain.com` under `qa/reports/launch-evidence/readiness/`.
- Execute the buyer smoke test from `docs/launch/SMOKE_TEST.md` and store notes/screenshots under `qa/reports/launch-evidence/smoke-tests/`.
- Save one clean supplemental Vite build log using `cd web && npm ci && npm run build` under `qa/reports/launch-evidence/frontend-build/`; this client is not served by the v1 Flask deployment.
- Update `qa/reports/mvp-readout.md` with the status of each must-pass evidence item.

## 4. Final verification

- Treat a failing local preflight as normal if your local `.env` is still in demo/dev mode.
- Run `python3 scripts/preflight_check.py` on the production server and require `"ok": true`.
- Run your repo/history secret-exposure check before launch; preflight does not replace secret hygiene review.
- Verify `GET /healthz` returns `{"ok":true}`.
- Verify `GET /readiness` returns `"ok": true` and review any warnings.
- Verify the deployed app still serves the expected security headers and that request throttling is active on the protected public endpoints.
- Run `python3 scripts/backup_db.py --label prelaunch` and confirm the backup file exists.
- Build the release archive with `python3 scripts/package_release.py --label prelaunch`.
- Use the whitelist packager above as the only supported release bundle path; do not zip the repo root manually.
- Confirm every Must-Pass Launch Gate item in [launch_readiness.md](/Users/seankeller/Documents/eBay Photos/launch_readiness.md) is either passed, explicitly waived in writing, or intentionally moved post-launch in writing.

## 5. Launch-day ops

- Monitor the support inbox during launch.
- Keep the latest DB backup path recorded.
- Keep rollback instructions and incident steps from `docs/launch/OPS_RUNBOOK.md` available.
