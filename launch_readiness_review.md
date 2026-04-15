# Launch Readiness Review

Review date: 2026-04-15

Canonical gate: [launch_readiness.md](/Users/seankeller/Documents/eBay Photos/launch_readiness.md)

## Executive Summary

Current judgment: **No-Go**

The repo is materially closer to launch-ready than before. The backend tests pass, the frontend production build succeeds, the release packager runs, and the app has real launch controls for Gumroad auth, CSRF, rate limiting, security headers, ownership checks, health, and readiness.

The product is still **not** launch-ready because at least five Must-Pass conditions remain unresolved:

1. The app/preflight bootstrap path does not reliably honor deployment values supplied outside `.env`, which undermines the intended production launch path validation.
2. The supported release archive omits the new canonical launch-readiness documents that the launch docs now point to.
3. The required launch-evidence artifact groups still contain only scaffolding/README files and no real evidence.
4. Real production legal/support/business identity values are not yet supplied and verified in a live deployment.
5. Real production `/readiness` and end-to-end smoke-test evidence for the Gumroad launch path do not yet exist.

## Highest-Priority Findings

### 1. [High] `.env` overrides externally supplied deployment values, so preflight cannot reliably validate the real launch configuration

Reference:

- [photo_prep_app/app.py](/Users/seankeller/Documents/eBay Photos/photo_prep_app/app.py:74)
- [photo_prep_app/app.py](/Users/seankeller/Documents/eBay Photos/photo_prep_app/app.py:91)

Why this matters:

- `load_dotenv(dotenv_path, override=True)` overwrites process environment values from `.env`.
- `APP_BASE_URL` and `STRIPE_WEBHOOK_SECRET` are then captured into module-level constants at import time.
- In practice, a launch-like preflight command with `APP_ENV=production`, `AUTH_MODE=gumroad`, and an HTTPS `APP_BASE_URL` still resolved as `AUTH_MODE=demo` and `APP_BASE_URL=http://127.0.0.1:5000` because the checked-in local `.env` won.

Observed reproduction:

- Command run:
  - `env APP_ENV=production AUTH_MODE=gumroad LAUNCH_MODE=true PHOTO_PREP_APP_SECRET=prod-secret-123 APP_BASE_URL=https://cardworks.app SUPPORT_EMAIL=launch@cardworks.app LEGAL_ENTITY_NAME='CardWorks LLC' LEGAL_CONTACT_ADDRESS='42 Launch Ave, Denver, CO 80202, USA' GUMROAD_PRODUCT_PERMALINK=cardworks-live GUMROAD_PRODUCT_URL=https://gumroad.com/l/cardworks-live python3 scripts/preflight_check.py`
- Result:
  - preflight still reported `AUTH_MODE=demo`
  - preflight still reported `APP_BASE_URL=http://127.0.0.1:5000`

Launch impact:

- This is a Deploy-Ready blocker.
- It conflicts with the launch definition that real production environment values can be supplied outside the repo and then validated cleanly.

### 2. [High] The supported release archive omits the canonical launch-readiness docs now referenced by the launch checklist

Reference:

- [scripts/package_release.py](/Users/seankeller/Documents/eBay Photos/scripts/package_release.py:12)
- [docs/launch/LAUNCH_CHECKLIST.md](/Users/seankeller/Documents/eBay Photos/docs/launch/LAUNCH_CHECKLIST.md:5)

Why this matters:

- `scripts/package_release.py` whitelists the bundle contents.
- The archive contains `docs/launch/LAUNCH_CHECKLIST.md`, which now tells operators to read `launch_readiness.md` first.
- The archive does **not** include `launch_readiness.md` or `AGENTS.md`, so the packaged release is internally inconsistent.

Observed evidence:

- `python3 scripts/package_release.py --label readiness-review` succeeded.
- `unzip -l dist-release/cardworks-readiness-review.zip` showed the archive contents.
- `launch_readiness.md` and `AGENTS.md` were absent from the archive.

Launch impact:

- This is a Repo-Ready blocker because the supported release package does not contain the canonical file the launch docs rely on.

### 3. [High] Required launch-evidence artifact groups are still empty apart from README scaffolding

Reference:

- [qa/reports/launch-evidence/heic/README.md](/Users/seankeller/Documents/eBay Photos/qa/reports/launch-evidence/heic/README.md:1)
- [qa/reports/launch-evidence/performance/README.md](/Users/seankeller/Documents/eBay Photos/qa/reports/launch-evidence/performance/README.md:1)
- [qa/reports/launch-evidence/export-validation/README.md](/Users/seankeller/Documents/eBay Photos/qa/reports/launch-evidence/export-validation/README.md:1)
- [qa/reports/launch-evidence/readiness/README.md](/Users/seankeller/Documents/eBay Photos/qa/reports/launch-evidence/readiness/README.md:1)
- [qa/reports/launch-evidence/smoke-tests/README.md](/Users/seankeller/Documents/eBay Photos/qa/reports/launch-evidence/smoke-tests/README.md:1)

Why this matters:

- The launch definition explicitly says placeholder folders do not satisfy launch readiness.
- The required evidence groups exist only as README scaffolding.
- No real HEIC validation evidence, performance evidence, export-validation output, readiness JSON, or smoke-test artifacts are present.

Observed evidence:

- `find qa/reports/launch-evidence -maxdepth 2 -type f | sort` returned only README files for the required groups.

Launch impact:

- This is a direct Core Product Confidence blocker and an overall Launch-Ready blocker.

### 4. [Medium] The archive still ships legacy evidence folders that conflict with the new canonical evidence layout

Reference:

- [scripts/package_release.py](/Users/seankeller/Documents/eBay Photos/scripts/package_release.py:24)
- [qa/reports/launch-evidence/README.md](/Users/seankeller/Documents/eBay Photos/qa/reports/launch-evidence/README.md:10)

Why this matters:

- The canonical evidence structure is now `heic/`, `performance/`, `export-validation/`, `readiness/`, and `smoke-tests/`.
- The release archive still includes `heic-samples/`, `profiling/`, and `smoke-test/` because the package script includes the entire `qa/` tree.
- That is not a security issue, but it reintroduces naming drift in the supported bundle.

Launch impact:

- This is not the main blocker by itself, but it weakens Repo-Ready coherence and should be cleaned up before final sign-off.

## Verification Run

### Commands run

- `python3 -m unittest discover -s tests -v`
- `npm run build` in `web/`
- `python3 scripts/package_release.py --label readiness-review`
- `python3 scripts/preflight_check.py`
- `env APP_ENV=production AUTH_MODE=gumroad LAUNCH_MODE=true PHOTO_PREP_APP_SECRET=prod-secret-123 APP_BASE_URL=https://cardworks.app SUPPORT_EMAIL=launch@cardworks.app LEGAL_ENTITY_NAME='CardWorks LLC' LEGAL_CONTACT_ADDRESS='42 Launch Ave, Denver, CO 80202, USA' GUMROAD_PRODUCT_PERMALINK=cardworks-live GUMROAD_PRODUCT_URL=https://gumroad.com/l/cardworks-live python3 scripts/preflight_check.py`
- `unzip -l dist-release/cardworks-readiness-review.zip`

### Results

- Backend automated tests: **Pass**
  - 28 tests passed.
- Frontend production build: **Pass**
  - Vite build completed successfully.
  - One bundle-size warning remains for `heic2any`, but the build passed.
- Release packager command: **Pass**
  - Archive built successfully.
- Local preflight with current repo `.env`: **Expected Fail**
  - Fails because the local setup is not configured as the production launch path.
- Launch-like preflight using external env vars: **Unexpected Fail**
  - Failed because `.env` import behavior overrode the supplied Gumroad/HTTPS values.

## Gate-by-Gate Assessment

### A. Repository and Build Integrity

Status: **Partial Pass, not complete**

Passed:

- Backend automated tests pass on the reviewed commit.
- Frontend production build succeeds.
- The documented release packaging command succeeds.
- `.env.production.example` exists and clearly separates required launch values from recommended/optional ones: [.env.production.example](/Users/seankeller/Documents/eBay Photos/.env.production.example:1)
- Launch gating is documented coherently across:
  - [launch_readiness.md](/Users/seankeller/Documents/eBay Photos/launch_readiness.md:1)
  - [docs/launch/LAUNCH_CHECKLIST.md](/Users/seankeller/Documents/eBay Photos/docs/launch/LAUNCH_CHECKLIST.md:1)
  - [docs/launch/CONFIG_REFERENCE.md](/Users/seankeller/Documents/eBay Photos/docs/launch/CONFIG_REFERENCE.md:1)
  - [DEPLOY_BLUEHOST_VPS.md](/Users/seankeller/Documents/eBay Photos/DEPLOY_BLUEHOST_VPS.md:1)

Still failing:

- The produced release archive does not include `launch_readiness.md`, even though the launch checklist requires it.
- The produced release archive includes legacy evidence folder names that no longer match the canonical layout.

### B. Production Configuration Readiness

Status: **Fail**

What is implemented well:

- Readiness checks enforce production-mode launch config, real support/legal values, Gumroad configuration, writable runtime paths, tesseract availability, and DB health:
  - [photo_prep_app/app.py](/Users/seankeller/Documents/eBay Photos/photo_prep_app/app.py:468)
  - [scripts/preflight_check.py](/Users/seankeller/Documents/eBay Photos/scripts/preflight_check.py:1)
- Gumroad mode is clearly treated as the intended v1 launch path:
  - [photo_prep_app/services/auth.py](/Users/seankeller/Documents/eBay Photos/photo_prep_app/services/auth.py:33)
  - [photo_prep_app/services/gumroad.py](/Users/seankeller/Documents/eBay Photos/photo_prep_app/services/gumroad.py:22)

What still blocks launch:

- No real production values have been provided and operator-verified yet.
- No real `/readiness` success artifact from a live or staging-like Gumroad deployment exists.
- The current bootstrap/preflight path does not reliably validate environment variables supplied outside `.env`.

### C. Security / Trust Minimums

Status: **Partial Pass, manual production checks still required**

Code-backed passes:

- CSRF protection is enforced on state-changing flows:
  - [photo_prep_app/app.py](/Users/seankeller/Documents/eBay Photos/photo_prep_app/app.py:217)
  - [tests/test_web_launch_gating.py](/Users/seankeller/Documents/eBay Photos/tests/test_web_launch_gating.py:47)
- Security headers are applied to HTML and JSON responses:
  - [photo_prep_app/app.py](/Users/seankeller/Documents/eBay Photos/photo_prep_app/app.py:562)
  - [tests/test_web_routes_security.py](/Users/seankeller/Documents/eBay Photos/tests/test_web_routes_security.py:207)
- Basic rate limiting exists for login, webhook, and batch submission:
  - [photo_prep_app/app.py](/Users/seankeller/Documents/eBay Photos/photo_prep_app/app.py:126)
  - [tests/test_web_routes_security.py](/Users/seankeller/Documents/eBay Photos/tests/test_web_routes_security.py:219)
- Cross-user batch access and expired asset access are blocked:
  - [tests/test_web_routes_security.py](/Users/seankeller/Documents/eBay Photos/tests/test_web_routes_security.py:44)
  - [tests/test_web_routes_security.py](/Users/seankeller/Documents/eBay Photos/tests/test_web_routes_security.py:70)

Still required before launch:

- Real deployed verification that HTTPS is enforced by the reverse proxy.
- Real deployed verification that throttling is active on the exposed production endpoints.
- Secret-exposure review of repo and history.
- Final manual inspection that the release archive contains only intended contents.

### D. Core Product Confidence

Status: **Fail**

What exists:

- Smoke-test checklist and runbook are written:
  - [docs/launch/SMOKE_TEST.md](/Users/seankeller/Documents/eBay Photos/docs/launch/SMOKE_TEST.md:1)
  - [docs/launch/OPS_RUNBOOK.md](/Users/seankeller/Documents/eBay Photos/docs/launch/OPS_RUNBOOK.md:1)
- Export validation tooling exists:
  - [qa/checks/export_validation.py](/Users/seankeller/Documents/eBay Photos/qa/checks/export_validation.py:1)
- Performance profiling plan exists:
  - [qa/checks/worker_profile_plan.md](/Users/seankeller/Documents/eBay Photos/qa/checks/worker_profile_plan.md:1)

What is still missing:

- Real HEIC validation evidence.
- Real performance/profile evidence at the agreed threshold.
- Real export-validation output.
- Real readiness/prod-like validation evidence.
- Real end-to-end Gumroad smoke-test evidence.

This category alone is currently sufficient for No-Go.

### E. Operational Support Readiness

Status: **Partial Pass, not complete**

What exists:

- Launch checklist, deployment guide, smoke test, and ops runbook are all present:
  - [docs/launch/LAUNCH_CHECKLIST.md](/Users/seankeller/Documents/eBay Photos/docs/launch/LAUNCH_CHECKLIST.md:1)
  - [DEPLOY_BLUEHOST_VPS.md](/Users/seankeller/Documents/eBay Photos/DEPLOY_BLUEHOST_VPS.md:1)
  - [docs/launch/SMOKE_TEST.md](/Users/seankeller/Documents/eBay Photos/docs/launch/SMOKE_TEST.md:1)
  - [docs/launch/OPS_RUNBOOK.md](/Users/seankeller/Documents/eBay Photos/docs/launch/OPS_RUNBOOK.md:1)

What is still missing:

- A real support inbox owner and response path.
- Real operator walkthrough evidence proving someone can interpret `/readiness`, preflight, and failure modes.
- Real production launch owner assignments and live-run validation.

## What Still Needs To Happen

### Code / Repo fixes

1. Fix app bootstrap so deployment environment values can override local `.env` values, or disable `.env` loading in production/preflight contexts.
2. Stop freezing critical launch config into module-level constants when runtime/env-driven validation needs current values.
3. Add `launch_readiness.md` to the release bundle whitelist.
4. Either remove legacy evidence directories from the supported bundle or reclassify them so the package no longer carries contradictory evidence paths.

### Real deployment inputs

1. Supply real production values for:
   - `APP_ENV=production`
   - `APP_BASE_URL`
   - `PHOTO_PREP_APP_SECRET`
   - `SUPPORT_EMAIL`
   - `LEGAL_ENTITY_NAME`
   - `LEGAL_CONTACT_ADDRESS`
   - Gumroad live product fields for the actual v1 launch path
2. Run preflight against the real launch deployment and save the result.
3. Capture a healthy `/readiness` response from the live or staging-like deployment.

### Required launch evidence

1. Add real HEIC validation artifacts under `qa/reports/launch-evidence/heic/`.
2. Add performance traces and summary under `qa/reports/launch-evidence/performance/`.
3. Add real export-validation outputs under `qa/reports/launch-evidence/export-validation/`.
4. Add readiness JSON artifacts under `qa/reports/launch-evidence/readiness/`.
5. Add main-path smoke-test notes/screenshots under `qa/reports/launch-evidence/smoke-tests/`.
6. Save a real clean frontend build log under `qa/reports/launch-evidence/frontend-build/`.

### Final operator checks

1. Verify HTTPS enforcement and security headers on the deployed public origin.
2. Verify rate limiting on the exposed endpoints.
3. Run the repo/history secret review.
4. Confirm the support inbox is staffed and owned.
5. Confirm every Must-Pass item is passed, waived in writing, or intentionally moved post-launch in writing.

## Bottom Line

The codebase is **not far from a disciplined v1 launch**, but it is **not launch-ready today**.

The fastest path to launch readiness is:

1. Fix the env/bootstrap issue so production preflight can validate the real Gumroad launch path reliably.
2. Fix the release bundle whitelist so the packaged release includes the canonical launch definition.
3. Collect the real evidence artifacts.
4. Supply and verify the real production legal/support/business values.

Until those are complete, the correct result remains **No-Go**.
