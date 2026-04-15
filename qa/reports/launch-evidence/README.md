# Launch Evidence Archive

Store launch sign-off artifacts here or in an equivalent private evidence folder.

This folder is intentionally scaffolded even when evidence is still pending.
Do not mark launch evidence complete until the real production artifacts exist.

Canonical requirements live in [launch_readiness.md](/Users/seankeller/Documents/eBay Photos/launch_readiness.md).

Required artifact groups for launch readiness:

- `heic/`
- `performance/`
- `export-validation/`
- `readiness/`
- `smoke-tests/`

Each required group should contain:

- a short summary of what was tested
- date collected
- commit/build/version tested
- environment tested
- result status
- raw evidence or links to it

Supplemental evidence that supports the Must-Pass Launch Gate may also be stored here.

Examples:

- `heic/` notes describing the device and capture conditions for each real HEIC batch
- `performance/` exported Chromium trace JSON files and a short summary
- `export-validation/` console output from `qa/checks/export_validation.py`
- `frontend-build/` saved output from `cd web && npm ci && npm run build`
- `smoke-tests/` screenshots or notes from the production buyer-flow run
- `readiness/` saved `/readiness` responses from the production environment

Update `qa/reports/mvp-readout.md` with links or filenames for the final sign-off packet.
