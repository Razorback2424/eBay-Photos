# Launch Config Reference

This repo distinguishes between two states:

- **Repo prepared for launch**: code, docs, packaging, and checks are ready for operators to use.
- **Deployment ready to launch**: a real production environment has been configured and passes readiness checks.

## Important rule

`scripts/preflight_check.py` and `GET /readiness` are intended to pass **only** against a real deployment configuration.

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

## Warnings vs failures

- Missing `SENTRY_DSN` and `PLAUSIBLE_DOMAIN` produce warnings, not hard launch failures.
- Stripe settings are not launch blockers when `AUTH_MODE=gumroad`.
- Auth0 settings are not launch blockers unless `AUTH_MODE=auth0`.

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

After that, collect the remaining external launch evidence under `qa/reports/launch-evidence/`.
