# Bluehost VPS Deployment (MVP)

This app can run on a Bluehost VPS for a paid MVP if you keep the runtime to a **single app process**.

Use [launch_readiness.md](/Users/seankeller/Documents/eBay Photos/launch_readiness.md) as the canonical launch gate. This document explains one supported deployment path and does not redefine what blocks launch.

## Important MVP Constraint

- Run **one Gunicorn worker only**.
- The app uses an in-process queue/background worker thread. Multiple Gunicorn workers will duplicate workers and break processing behavior.

## 1. System Packages (Ubuntu/Debian-style example)

Install OS deps required by image processing:

```bash
sudo apt-get update
sudo apt-get install -y \
  python3 python3-venv python3-pip \
  tesseract-ocr \
  libgl1 libglib2.0-0 \
  libheif1 libheif-dev
```

Notes:
- `tesseract-ocr` is required for `pytesseract`
- `libheif*` supports HEIC decoding (`pillow-heif`)
- `libgl1` / `libglib2.0-0` are commonly needed by OpenCV at runtime

## 2. App Setup

```bash
cd /path/to/deploy
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements-web.txt
```

For the browser frontend, use Node `22.16.x` and verify a clean build:

```bash
cd web
npm ci
npm run build
cd ..
```

## 3. Environment Config

Create a production `.env`:

```bash
cp .env.production.example .env
```

Important:
- `.env.production.example` is intentionally non-live and should fail readiness until edited.
- `.env.production.example` must never contain valid secrets, live product IDs, or real support/legal business data.
- A local demo/dev `.env` is expected to fail launch readiness.
- Use [docs/launch/CONFIG_REFERENCE.md](/Users/seankeller/Documents/eBay Photos/docs/launch/CONFIG_REFERENCE.md) as the source of truth for launch-mode config expectations.

Set at minimum:
- `APP_ENV=production`
- `APP_BASE_URL=https://your-domain.com`
- `PHOTO_PREP_APP_SECRET=<real random secret>`
- `LAUNCH_MODE=true`
- `AUTH_MODE=gumroad`
- `GUMROAD_PRODUCT_PERMALINK=<real product slug>` or `GUMROAD_PRODUCT_ID=<real product id>`
- `GUMROAD_PRODUCT_URL=<real product URL>`
- `SUPPORT_EMAIL=<real monitored inbox>`
- `LEGAL_ENTITY_NAME=<real business name>`
- `LEGAL_CONTACT_ADDRESS=<real business contact address>`
- `FREE_TRIAL_ENABLED=true`
- `FREE_TRIAL_CARDS_TOTAL=25`
- `MASTER_USER_EMAILS=<owner emails>`
- `ENABLE_DEMO_BILLING_CONTROLS=false`

If you still maintain a separate Stripe subscription flow in your deployment, configure the Stripe variables as well. For the current Gumroad launch path, do not use the Auth0 block as your minimum production setup.

## 4. Preflight Checks

Run:

```bash
source .venv/bin/activate
python3 scripts/preflight_check.py
```

This script prints a JSON checklist and exits non-zero if any required launch checks fail.
Warnings are included for optional-but-recommended monitoring gaps such as missing Sentry or Plausible configuration.
If you run it against a local demo/dev `.env`, failure is expected and not a launch signal.

After it passes, start the app and verify:
- `https://your-domain-or-ip/healthz` -> ok
- `https://your-domain-or-ip/readiness` -> no issues before go-live

Archive the readiness payload:

```bash
python3 scripts/capture_readiness.py --base-url https://your-domain.com
```

## 5. Run with Gunicorn (single worker)

```bash
source .venv/bin/activate
gunicorn -c gunicorn.conf.py wsgi:application
```

Default bind is `127.0.0.1:8000`.
Do not add a `--workers` override. The checked-in `gunicorn.conf.py` already pins `workers = 1`, which is required for the in-process queue/background worker model.

## 6. Reverse Proxy (Nginx/Apache)

Configure your reverse proxy to:
- terminate TLS (HTTPS)
- proxy to `127.0.0.1:8000`
- allow large request bodies (match your `MAX_CONTENT_LENGTH_MB`)

If using Nginx, ensure:
- `client_max_body_size` is high enough for your upload batches

## 7. Gumroad Launch Notes

- Configure the Gumroad product to deliver the license key immediately after purchase.
- Paste your custom confirmation copy into Gumroad so buyers get clear access instructions instead of the default template.
- The product page and post-purchase message should send customers to `/login` to enter the purchase email and license key.

## 8. Optional Stripe Billing

If you are running the separate Stripe subscription path in parallel, configure:

- webhook endpoint: `https://your-domain.com/webhooks/stripe`
- events:
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `checkout.session.completed`

This is optional for the Gumroad-first launch flow. Auth0 is not part of the minimum production setup for launch.

## 9. Persistence / Backups

SQLite DB file:
- `photo_prep_app.db`

MVP recommendation:
- nightly backup of `photo_prep_app.db`
- use `python3 scripts/backup_db.py --label nightly --out-dir backups/`

`_Web_Runs/` is temporary (24h retention). Backing it up is usually unnecessary.

## 10. Before Going Live

1. Confirm `.env` uses `APP_ENV=production`
2. Confirm `.env` uses `LAUNCH_MODE=true`
3. Confirm `.env` uses `AUTH_MODE=gumroad`
4. Confirm `ENABLE_DEMO_BILLING_CONTROLS=false`
5. Confirm `PHOTO_PREP_APP_SECRET` is a real random secret
6. Confirm Gumroad product settings send the buyer their license key and direct them to `/login`
7. Confirm Gunicorn is starting with `-c gunicorn.conf.py` and still running one worker
8. Confirm `SUPPORT_EMAIL`, `LEGAL_ENTITY_NAME`, and `LEGAL_CONTACT_ADDRESS` are set to real launch values
9. Save the latest DB backup path from `python3 scripts/backup_db.py --label prelaunch`
10. Build a clean release archive with `python3 scripts/package_release.py --label prelaunch`
11. Use the whitelist archive above instead of zipping the repo root
12. Run your secret-exposure review before launch; preflight only validates config shape
13. Verify the live deployment still returns the expected security headers and throttles the protected public endpoints
14. Confirm the remaining blockers, if any, are only those allowed by [launch_readiness.md](/Users/seankeller/Documents/eBay Photos/launch_readiness.md)

## 11. Post-Launch Smoke Test

1. Sign up / sign in
2. Use free trial to process 1 batch
3. Confirm batch page + ZIP download
4. Complete a Gumroad purchase with the real product link
5. Confirm the buyer can enter the purchase email + license key at `/login`
6. Confirm paid processing still works
7. Save `/readiness` output under `qa/reports/launch-evidence/readiness/`
8. Archive smoke-test evidence under `qa/reports/launch-evidence/smoke-tests/`
