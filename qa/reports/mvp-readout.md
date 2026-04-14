# MVP QA Readout

## Current status
- **Repo/documentation status:** launch prep hardening is in place for config validation, release packaging, and evidence collection scaffolding.
- **Launch evidence status:** still blocked on external artifacts that must be collected from real HEIC samples and a real production deployment.

## Asset coverage
- **JPEG batches** generated via `qa/assets/generate_test_images.py` provide deterministic
  brightness gradients for controlled, low-light, and cluttered card scenarios. These
  assets live under `qa/assets/jpg/` and are referenced by `qa/assets/manifest.json` for
  quick lookup.
- **HEIC coverage** is currently blocked. The offline environment cannot synthesize
  real HEIC captures; `qa/assets/heic/PLACEHOLDER.md` documents the need to source
  48 MP samples from physical devices. Release is gated on acquiring and checking in
  at least one representative HEIC batch to exercise the HEIC ingest and export path.
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
- **Blocked:** npm dependencies cannot be installed in the current environment
  (`npm install` fails with HTTP 403), preventing local profiling runs. Profiling must
  be executed on an environment with registry access and real HEIC assets.

## Outstanding issues / release gates
1. **HEIC asset acquisition** – must populate `qa/assets/heic/` with real 48 MP samples
   before acceptance.
2. **Performance trace capture** – execute the profiling plan and attach metrics before
   sign-off. Document frame stability and worker throughput in this report.
3. **ZIP parity validation** – once exports are produced, archive the validation output
   (pass/fail logs) alongside traces for traceability.

## Launch evidence checklist
- HEIC sample notes:
  - Pending
- Worker/profile traces:
  - Pending
- Export validation logs:
  - Pending
- Frontend clean build log:
  - Pending
- Production readiness output:
  - Pending
- End-to-end smoke test notes:
  - Pending

## Operator checklist for final sign-off
- Replace every `REPLACE_IN_DEPLOYMENT_*` value in the production `.env`.
- Run `cd web && npm ci && npm run build` on the deployment candidate and save the log under `qa/reports/launch-evidence/frontend-build/`.
- Run `python3 scripts/preflight_check.py` against the real production env and require `"ok": true`.
- Run `python3 scripts/capture_readiness.py --base-url https://your-domain.com` and save the JSON under `qa/reports/launch-evidence/readiness/`.
- Add at least one real 48 MP HEIC batch and notes under `qa/reports/launch-evidence/heic-samples/`.
- Run the profiling plan and save the trace plus summary under `qa/reports/launch-evidence/profiling/`.
- Run export validation and save the output under `qa/reports/launch-evidence/export-validation/`.
- Run the buyer smoke test and save notes/screenshots under `qa/reports/launch-evidence/smoke-test/`.

Release remains gated until the above items are completed and real evidence is attached to this readout.
