#!/usr/bin/env python3
"""Fetch /readiness from a deployed app and save it under launch evidence."""

from __future__ import annotations

import argparse
from datetime import datetime
import json
from pathlib import Path
import urllib.request


PROJECT_ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True, help="Public deployment origin, for example https://cardworks.example.com")
    parser.add_argument(
        "--out-dir",
        default="qa/reports/launch-evidence/readiness",
        help="Directory to write the readiness JSON artifact into",
    )
    args = parser.parse_args()

    target = args.base_url.rstrip("/") + "/readiness"
    with urllib.request.urlopen(target, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))

    out_dir = (PROJECT_ROOT / args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output_path = out_dir / f"readiness-{timestamp}.json"
    output_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(str(output_path))


if __name__ == "__main__":
    main()
