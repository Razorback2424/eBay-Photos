# Launch Smoke Test

Run this against the real production deployment after preflight passes.

## Access and purchase flow

1. Open the landing page over HTTPS.
2. Open `/login`.
3. Click the Gumroad purchase link and confirm it goes to the live product.
4. Complete a real or controlled test purchase.
5. Confirm the buyer receives a Gumroad receipt with a license key.
6. Sign in at `/login` using the purchase email and license key.
7. Sign out and repeat sign-in from a second browser profile or device.

## Processing flow

1. Upload a small JPEG front batch and matching back batch.
2. Complete pairing review and submit the batch.
3. Wait for processing to finish.
4. Open the batch page and preview at least one output image.
5. Download the ZIP and verify the expected image count and filenames.
6. Validate the downloaded ZIP with `python3 qa/checks/export_validation.py`.

## Failure-path checks

1. Attempt a login with an invalid license key and confirm the error is clear.
2. Attempt to access another account's batch URL and confirm it fails.
3. Attempt a request without CSRF where applicable and confirm it is rejected.
4. Restart the app during a queued or running batch and confirm incomplete work is marked failed after startup.
5. Confirm expired batches cannot be previewed or downloaded.

## Evidence to keep

- Production `/readiness` response
- Purchase receipt screenshot or order reference
- Successful login screenshot
- Batch completion screenshot
- Export validation output
- Any error-monitoring event IDs if issues are observed
