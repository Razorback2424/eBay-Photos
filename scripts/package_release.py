#!/usr/bin/env python3
"""Create a clean release archive from an explicit whitelist."""

from __future__ import annotations

import argparse
from pathlib import Path
import zipfile


PROJECT_ROOT = Path(__file__).resolve().parent.parent
INCLUDE_PATHS = (
    ".env.example",
    ".env.production.example",
    "AGENTS.md",
    "DEPLOY_BLUEHOST_VPS.md",
    "GUMROAD_CONFIRMATION_COPY.md",
    "WEB_UI.md",
    "app.py",
    "gunicorn.conf.py",
    "launch_readiness.md",
    "requirements-web.txt",
    "web_app.py",
    "wsgi.py",
    "docs",
    "photo_prep_app",
    "qa",
    "scripts",
    "tests",
    "web",
)
EXCLUDE_DIR_NAMES = {
    ".git",
    ".playwright-cli",
    ".playwright-fixtures",
    "__pycache__",
    "__MACOSX",
    "node_modules",
    "dist",
    ".vite",
}
EXCLUDE_FILE_NAMES = {
    ".DS_Store",
    "photo_prep_app.db",
}
EXCLUDE_SUFFIXES = {
    ".pyc",
}
EXCLUDE_RELATIVE_DIR_PREFIXES = (
    Path("qa/reports/launch-evidence/heic-samples"),
    Path("qa/reports/launch-evidence/profiling"),
    Path("qa/reports/launch-evidence/smoke-test"),
)


def iter_release_files():
    for relative in INCLUDE_PATHS:
        path = PROJECT_ROOT / relative
        if not path.exists():
            continue
        if path.is_file():
            yield path
            continue
        for child in path.rglob("*"):
            if not child.is_file():
                continue
            relative = child.relative_to(PROJECT_ROOT)
            if any(part in EXCLUDE_DIR_NAMES for part in relative.parts):
                continue
            if any(relative.is_relative_to(prefix) for prefix in EXCLUDE_RELATIVE_DIR_PREFIXES):
                continue
            if child.name in EXCLUDE_FILE_NAMES or child.suffix in EXCLUDE_SUFFIXES:
                continue
            yield child


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", default="dist-release", help="Directory to write the archive into")
    parser.add_argument("--label", default="launch", help="Archive label")
    args = parser.parse_args()

    out_dir = (PROJECT_ROOT / args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    archive_path = out_dir / f"cardworks-{args.label}.zip"

    seen = set()
    with zipfile.ZipFile(archive_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for file_path in sorted(iter_release_files()):
            relative = file_path.relative_to(PROJECT_ROOT)
            if relative in seen:
                continue
            seen.add(relative)
            archive.write(file_path, arcname=str(relative))

    print(str(archive_path))


if __name__ == "__main__":
    main()
