# Bluehost VPS Deployment (MVP)

This app can run on a Bluehost VPS for a paid MVP if you keep the runtime to a **single app process**.

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

## 3. Environment Config

Create a production `.env`:

```bash
cp .env.production.example .env
```

Set at minimum:
- `APP_ENV=production`
- `APP_BASE_URL=https://your-domain.com`
- `PHOTO_PREP_APP_SECRET=...`
- `AUTH_MODE=auth0`
- `AUTH0_*`
- `FREE_TRIAL_ENABLED=true`
- `FREE_TRIAL_CARDS_TOTAL=25`
- `MASTER_USER_EMAILS=your-email@example.com`
- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_ID`
- `STRIPE_WEBHOOK_SECRET`
- `ENABLE_DEMO_BILLING_CONTROLS=false`

## 4. Preflight Checks

Run:

```bash
source .venv/bin/activate
python3 scripts/preflight_check.py
```

This script prints a JSON checklist and exits non-zero if any required launch checks fail.

After it passes, start the app and verify:
- `https://your-domain-or-ip/healthz` -> ok
- `https://your-domain-or-ip/readiness` -> no issues before go-live

## 5. Run with Gunicorn (single worker)

```bash
source .venv/bin/activate
gunicorn -c gunicorn.conf.py wsgi:application
```

Default bind is `127.0.0.1:8000`.

## 6. Reverse Proxy (Nginx/Apache)

Configure your reverse proxy to:
- terminate TLS (HTTPS)
- proxy to `127.0.0.1:8000`
- allow large request bodies (match your `MAX_CONTENT_LENGTH_MB`)

If using Nginx, ensure:
- `client_max_body_size` is high enough for your upload batches

## 7. Stripe Webhook

In Stripe dashboard, configure webhook endpoint:

- `https://your-domain.com/webhooks/stripe`

Subscribe to:
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `checkout.session.completed`

## 8. Auth0 URLs

In Auth0 app config:
- Allowed Callback URLs:
  - `https://your-domain.com/auth/callback`
- Allowed Logout URLs:
  - `https://your-domain.com/workspace`
- Allowed Web Origins:
  - `https://your-domain.com`

## 9. Persistence / Backups

SQLite DB file:
- `photo_prep_app.db`

MVP recommendation:
- nightly backup of `photo_prep_app.db`

`_Web_Runs/` is temporary (24h retention). Backing it up is usually unnecessary.

## 10. Post-Launch Smoke Test

1. Sign up / sign in
2. Use free trial to process 1 batch
3. Confirm batch page + ZIP download
4. Run Stripe checkout
5. Confirm webhook updates subscription status
6. Confirm paid processing still works
