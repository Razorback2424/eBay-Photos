# Export validation checks

Run `python export_validation.py --dir-export <path>` after completing an export to
ensure naming and file counts are correct. Provide `--zip-export` with the fallback
archive to confirm both delivery modes remain in sync. Use `--expect-warped` when the
export enabled warped fronts. Save the console output under
`qa/reports/launch-evidence/export-validation/` or your private launch-evidence folder.

For launch sign-off, also archive:

- the clean frontend build output from `cd web && npm ci && npm run build`
- the production readiness JSON from `python3 scripts/capture_readiness.py --base-url https://your-domain.com`
