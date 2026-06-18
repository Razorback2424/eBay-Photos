# MVP QA Readout

## Current status
- **Repo/documentation status:** launch prep hardening is in place for config validation, release packaging, and evidence collection scaffolding.
- **Public runtime:** the v1 launch path is the Flask/Gunicorn app. The standalone Vite client and centering route are post-launch and are not served by the documented deployment.
- **Local preflight interpretation:** local config-shape validation is now mostly complete. Current local preflight passes all launch-config structure checks except the intentionally unresolved real-world launch identity/contact values: `SUPPORT_EMAIL`, `LEGAL_ENTITY_NAME`, and `LEGAL_CONTACT_ADDRESS`.
- **Launch evidence status:** still blocked on the Must-Pass launch evidence and real deployment values defined in [launch_readiness.md](/Users/seankeller/Documents/eBay Photos/launch_readiness.md).

## Asset coverage
- **JPEG batches** generated via `qa/assets/generate_test_images.py` provide deterministic
  brightness gradients for controlled, low-light, and cluttered card scenarios. These
  assets live under `qa/assets/jpg/` and are referenced by `qa/assets/manifest.json` for
  quick lookup.
- **HEIC coverage** was not formally re-run in this review pass. Operational confidence
  remains high because the app has been used successfully with real HEIC photos for
  months in normal use. Based on sustained real-world usage, HEIC upload and processing
  are considered operationally validated for MVP launch confidence. See
  `qa/reports/launch-evidence/heic/2026-04-15-operational-validation-note.md`.
- **Mixed format guidance** exists under `qa/assets/mixed_formats/README.md` to combine
  JPEG and HEIC sets once HEIC captures are available.

## Export validation checks
- Added `qa/checks/export_validation.py` to perform automated verification across
  directory and ZIP exports, ensuring:
  - each pair receives listing + quadrant crops (and warped fronts when requested);
  - consistent file extensions per pair;
  - MANIFEST.json content parity; and
  - identical file layouts between directory exports and ZIP fallbacks.
- Usage is summarized in `qa/checks/README.md`. Run the script after each export to
  confirm bundles before handing off to marketplace stakeholders.

## Worker throughput & UI responsiveness
- Created `qa/checks/worker_profile_plan.md` describing the Chromium profiling flow
  (record worker and main-thread activity while exporting high-resolution HEIC + JPEG
  batches). This plan highlights the need to collect DevTools traces in production
  builds to ensure the main thread remains below 16 ms frame budgets.
- **Current status:** formal performance/profile artifact collection was not re-run in
  this pass. Operational confidence remains based on repeated normal use of the app
  rather than newly captured local evidence artifacts during this review pass.

## Supplemental Vite build proof
- Revalidated locally on 2026-06-18 with:
  - `cd web`
  - `npm ci`
  - `npm run build`
- Result: pass. This is a repository-integrity check, not proof that the Vite routes are publicly deployed.
- The frontend production build completed successfully and produced a release build
  without errors. Non-blocking warnings were present, including npm audit vulnerability
  warnings and a Vite chunk-size warning related to the HEIC bundle, but there were no
  build failures.

## Release-bundle proof
- Revalidated locally on 2026-06-18 with:
  - `python3 scripts/package_release.py --label prelaunch`
  - `unzip -l dist-release/cardworks-prelaunch.zip`
- Result: pass.
- The supported prelaunch archive was rebuilt successfully and the archive listing was
  reviewed for the current checkout.

## Outstanding issues / release gates
1. **HEIC formal artifact refresh** – operational confidence is now documented in launch
   evidence, but a formal archived HEIC artifact refresh remains deferred for this pass.
2. **Performance trace capture** – execute the profiling plan and attach metrics before
   sign-off. Document frame stability and worker throughput in this report.
3. **ZIP parity validation** – once exports are produced, archive the validation output
   (pass/fail logs) alongside traces for traceability.
4. **Real production config values** – launch remains blocked until the actual Gumroad-path
   production config, legal/support values, and readiness output are supplied outside the repo.

## Launch evidence checklist
- HEIC sample notes:
  - Deferred formal artifact refresh; operational confidence based on repeated real use
- Worker/profile traces:
  - Deferred formal artifact refresh; operational confidence based on repeated real use
- Export validation logs:
  - Deferred formal artifact refresh; operational confidence based on repeated real use
- Frontend clean build log:
  - Passed locally on 2026-04-15 via `cd web && npm ci && npm run build`
- Release bundle proof:
  - Passed locally on 2026-04-15 via `python3 scripts/package_release.py --label prelaunch`
- Production readiness output:
  - Pending
- End-to-end smoke test notes:
  - Pending

Required artifact locations:

- `qa/reports/launch-evidence/heic/`
- `qa/reports/launch-evidence/performance/`
- `qa/reports/launch-evidence/export-validation/`
- `qa/reports/launch-evidence/readiness/`
- `qa/reports/launch-evidence/smoke-tests/`

## Operator checklist for final sign-off
- Replace every `REPLACE_IN_DEPLOYMENT_*` value in the production `.env`.
- Use non-secret dummy values only for config-shape validation outside the real deployment secret store.
- Replace placeholder `SUPPORT_EMAIL` with a real monitored inbox.
- Replace placeholder `LEGAL_ENTITY_NAME` with the real legal launch name.
- Replace placeholder `LEGAL_CONTACT_ADDRESS` with the real public-facing contact address.
- Run `cd web && npm ci && npm run build` on the deployment candidate and save the log under `qa/reports/launch-evidence/frontend-build/`.
- Run `python3 scripts/preflight_check.py` against the real production env and require `"ok": true`.
- Run the project secret-exposure review before launch; do not rely on preflight for secret hygiene.
- Run `python3 scripts/capture_readiness.py --base-url https://your-domain.com` and save the JSON under `qa/reports/launch-evidence/readiness/`.
- Confirm the deployed runtime returns the expected security headers and that throttling is observable on the protected public endpoints.
- Add at least one real 48 MP HEIC batch and notes under `qa/reports/launch-evidence/heic/`.
- Run the profiling plan and save the trace plus summary under `qa/reports/launch-evidence/performance/`.
- Run export validation and save the output under `qa/reports/launch-evidence/export-validation/`.
- Run the buyer smoke test and save notes/screenshots under `qa/reports/launch-evidence/smoke-tests/`.

Release remains gated until the Must-Pass Launch Gate in [launch_readiness.md](/Users/seankeller/Documents/eBay Photos/launch_readiness.md) is satisfied and real evidence is attached to this readout.
