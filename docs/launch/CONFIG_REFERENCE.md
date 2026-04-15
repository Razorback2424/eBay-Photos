# Launch Config Reference

This repo distinguishes between two states:

- **Repo prepared for launch**: code, docs, packaging, and checks are ready for operators to use.
- **Deployment ready to launch**: a real production environment has been configured and passes readiness checks.

Canonical go/no-go criteria live in [launch_readiness.md](/Users/seankeller/Documents/eBay Photos/launch_readiness.md). This file only defines configuration expectations for the intended launch path.

## Important rule

`scripts/preflight_check.py` and `GET /readiness` are intended to pass **only** against a real deployment configuration.
The checked-in `.env.production.example` must never contain valid secrets, live product IDs, or real support/legal/customer-facing business data.

Expected outcomes:

- Local `.env` in demo/dev mode: preflight should fail.
- Checked-in `.env.production.example`: preflight should fail until every `REPLACE_IN_DEPLOYMENT_*` value is replaced.
- Real production `.env` with live business values and launch config: preflight should pass with `"ok": true`.

## Required before launch-mode preflight can pass

- `APP_ENV=production`
- `APP_BASE_URL` uses the public HTTPS origin
- `PHOTO_PREP_APP_SECRET` is a real random secret
- `SUPPORT_EMAIL` is a real monitored inbox
- `LEGAL_ENTITY_NAME` is the real business name
- `LEGAL_CONTACT_ADDRESS` is the real contact address
- `AUTH_MODE=gumroad`
- `LAUNCH_MODE=true`
- `GUMROAD_PRODUCT_URL` or `GUMROAD_PRODUCT_PERMALINK` points to the real launch product

These are the required config-side launch blockers for the current public launch path:

- `APP_ENV`
- `APP_BASE_URL`
- `PHOTO_PREP_APP_SECRET`
- `SUPPORT_EMAIL`
- `LEGAL_ENTITY_NAME`
- `LEGAL_CONTACT_ADDRESS`
- Gumroad values required for the intended v1 launch path

## Warnings vs failures

- Missing `SENTRY_DSN` and `PLAUSIBLE_DOMAIN` produce warnings, not hard launch failures.
- Stripe settings are not launch blockers when `AUTH_MODE=gumroad`.
- Auth0 settings are not launch blockers unless `AUTH_MODE=auth0`.
- Alternate payment or auth paths are out of scope for the v1 launch gate unless explicitly promoted in writing.

## Recommended proof sequence on the production deployment

```bash
cp .env.production.example .env
# replace every REPLACE_IN_DEPLOYMENT value in .env

cd web
npm ci
npm run build
cd ..

python3 scripts/preflight_check.py
python3 scripts/capture_readiness.py --base-url https://your-domain.com
python3 scripts/package_release.py --label prelaunch
```

After that, collect the remaining external launch evidence under the required artifact groups described in [launch_readiness.md](/Users/seankeller/Documents/eBay Photos/launch_readiness.md).

## Separate launch controls beyond preflight

Preflight validates config shape and readiness rules. It does **not** prove that secrets were never committed or exposed.

Before launch, also:

- run your secret-exposure review for the repository and git history
- confirm the deployed runtime still returns the expected security headers
- confirm request throttling is active on the protected public endpoints in production
