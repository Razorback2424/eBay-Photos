# MVP QA Readout

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

Release remains gated until the above items are completed and evidence (assets, traces,
validation logs) is attached to this readout.