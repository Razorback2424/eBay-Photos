# Card Scan Splitter Vite Prototype

> Launch scope: this `web/` client is not served by the v1 Flask/Gunicorn deployment and is not part of the Gumroad public launch. The public v1 workspace is `photo_prep_app/templates/workspace.html`. The Vite centering tool and browser export linkage remain post-launch until they are wired into the authenticated deployment and receive live smoke-test evidence.

Use Node `22.16.x` for the web build.

## GitHub Pages

The browser-only client can be published as a static GitHub Pages site. The
workflow at `.github/workflows/deploy-pages.yml` builds `web/`, sets the
repository-relative Vite base path, and copies the app entry point to
`404.html` so direct navigation to workflow routes continues to work on Pages.

The Pages build does not include Flask, Gumroad authentication, or server-side
processing. ZIP export is the portable path for phones and browsers without the
File System Access API; desktop Chromium can additionally export directly to a
selected folder.

The repository root also contains the latest static build because this
repository is currently configured in GitHub Pages' `Deploy from a branch`
mode. Keep those generated root files synchronized with `web/dist` until Pages
is switched to the Actions workflow.

For a local production-style check:

```bash
cd web
npm ci
VITE_BASE_PATH=/ebay-photos/ npm run build
cp dist/index.html dist/404.html
npm run preview -- --host 127.0.0.1
```

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
