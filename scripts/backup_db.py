#!/usr/bin/env python3
"""Create a timestamped SQLite backup for launch operations."""

from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path


def backup_sqlite(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(source) as src_conn:
        with sqlite3.connect(destination) as dst_conn:
            src_conn.backup(dst_conn)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backup the production SQLite database.")
    parser.add_argument(
        "--db",
        default="photo_prep_app.db",
        help="Path to the SQLite database file. Default: photo_prep_app.db",
    )
    parser.add_argument(
        "--out-dir",
        default="backups",
        help="Directory where the backup file should be written. Default: backups",
    )
    parser.add_argument(
        "--label",
        default="manual",
        help="Short label included in the backup filename. Default: manual",
    )
    args = parser.parse_args(argv)

    source = Path(args.db).resolve()
    if not source.exists():
        print(f"fatal: database file not found: {source}", file=sys.stderr)
        return 2

    label = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in args.label).strip("-") or "manual"
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    destination = Path(args.out_dir).resolve() / f"{source.stem}-{label}-{timestamp}{source.suffix}"

    try:
        backup_sqlite(source, destination)
    except sqlite3.Error:
        # Fall back to a straight copy if the DB is not accepting sqlite backup calls.
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)

    print(destination)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
