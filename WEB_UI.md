# Card Scan Splitter Vite Prototype

> Launch scope: this `web/` client is not served by the v1 Flask/Gunicorn deployment and is not part of the Gumroad public launch. The public v1 workspace is `photo_prep_app/templates/workspace.html`. The Vite centering tool and browser export linkage remain post-launch until they are wired into the authenticated deployment and receive live smoke-test evidence.

Use Node `22.16.x` for the web build.

Install and verify from a clean checkout:

```bash
cd web
npm ci
npm run build
```

Install backend dependencies:

```bash
python3 -m pip install -r requirements-web.txt
```

Start the app:

```bash
python3 web_app.py
```

Open:

```text
http://127.0.0.1:5000
```

Workflow:

1. Upload one or many front scans in the Front box.
2. Upload one or many back scans in the Back box.
3. Select `Fast` (best throughput) or `Quality` (OCR/API naming).
4. Click `Add To Queue`.
5. Watch the auto-refreshing job status page.
6. Download ZIP when the job is complete.

Pairing rule:

- Pairing is by upload order, not filename.
- Front #1 pairs with Back #1, Front #2 with Back #2, etc.
- Front and back counts must match.

Job output location on disk:

```text
_Web_Runs/<job-id>/
```

Each card folder should contain:

- `1` full front image
- `1` full back image
- `4` front quadrant images
- `4` back quadrant images
