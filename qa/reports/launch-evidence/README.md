# Launch Evidence Archive

Store launch sign-off artifacts here or in an equivalent private evidence folder.

Recommended contents:

- `heic-samples/` notes describing the device and capture conditions for each real HEIC batch
- `profiling/` exported Chromium trace JSON files and a short summary
- `export-validation/` console output from `qa/checks/export_validation.py`
- `smoke-test/` screenshots or notes from the production buyer-flow run
- `readiness/` saved `/readiness` responses from the production environment

Update `qa/reports/mvp-readout.md` with links or filenames for the final sign-off packet.
