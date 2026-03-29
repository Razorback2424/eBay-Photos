# Launch Ops Runbook

## Ownership

- Assign one owner for production deploys.
- Assign one owner for the support inbox.
- Assign one owner for Gumroad product settings and refund handling.

## Monitoring

- Check `/readiness` after each deploy.
- If `SENTRY_DSN` is configured, review new production errors during launch week.
- If `PLAUSIBLE_DOMAIN` is configured, review traffic and conversion anomalies after launch announcements.

## Backups

- Run `python3 scripts/backup_db.py --label nightly --out-dir backups/`.
- Keep at least one known-good backup before each deploy and before launch.
- Test restore on a non-production copy before relying on the backup process.

## Common incidents

### Buyer cannot log in

- Confirm the buyer is using the purchase email from Gumroad.
- Confirm the license key matches the receipt.
- Check whether Gumroad verification is temporarily failing.
- If needed, reproduce with `GUMROAD_TEST_LICENSE_KEYS` in a non-production environment only.

### Batch is stuck or failed

- Check app logs for the batch ID.
- Confirm the app is still single-worker and `_Web_Runs/` is writable.
- Restart the app if needed; incomplete batches should be marked failed on startup.
- Ask the customer to re-run the batch if the work cannot be recovered safely.

### Download or preview missing

- Check whether the batch expired due to the retention window.
- Confirm the batch directory and ZIP still exist under `_Web_Runs/<job-id>/`.
- If the retention policy removed the assets, explain the expiry and ask the user to re-run the batch.

## Rollback

- Keep the previous app revision and latest DB backup available before deploy.
- If launch introduces a blocker, stop announcements, restore the previous revision, run `/readiness`, and verify login plus batch processing before reopening access.
