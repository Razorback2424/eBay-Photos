#!/usr/bin/env python3
"""Validate export bundles for expected structure.

Usage:
    python export_validation.py --dir-export path/to/export --expect-warped
    python export_validation.py --dir-export path --zip-export export.zip

The script checks that each pair directory contains the expected naming
convention (listing + four quadrants, optional warped) for fronts and backs.
When both directory and ZIP exports are provided it ensures the file listings
match to guarantee parity between directory access and fallback downloads.
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

EXPECTED_FRONT = [
    "FRONT_LISTING",
    "FRONT_TOP_LEFT",
    "FRONT_TOP_RIGHT",
    "FRONT_BOTTOM_LEFT",
    "FRONT_BOTTOM_RIGHT",
]
EXPECTED_BACK = [
    "BACK_LISTING",
    "BACK_TOP_LEFT",
    "BACK_TOP_RIGHT",
    "BACK_BOTTOM_LEFT",
    "BACK_BOTTOM_RIGHT",
]


class ExportIssue(Exception):
    """Raised when validation detects a problem."""


def _is_image(path: Path) -> bool:
    return path.suffix.lower() in {".jpg", ".jpeg", ".png"}


def _load_manifest(path: Path) -> Optional[dict]:
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return None
    except json.JSONDecodeError as exc:
        raise ExportIssue(f"Invalid JSON in manifest {path}: {exc}") from exc


def _relative(root: Path, path: Path) -> str:
    return str(path.relative_to(root).as_posix())


def _collect_directory(root: Path) -> Dict[str, List[str]]:
    mapping: Dict[str, List[str]] = {}
    for path in root.rglob("*"):
        if path.is_file() and _is_image(path):
            parent = path.parent.relative_to(root).as_posix()
            mapping.setdefault(parent, []).append(path.name)
    return {key: sorted(values) for key, values in mapping.items()}


def _collect_zip(zip_path: Path) -> Dict[str, List[str]]:
    mapping: Dict[str, List[str]] = {}
    with zipfile.ZipFile(zip_path) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            name = Path(info.filename)
            if _is_image(Path(name.name)):
                folder = str(name.parent.as_posix()).strip("./")
                mapping.setdefault(folder, []).append(name.name)
    return {key: sorted(values) for key, values in mapping.items()}


def _validate_pair_images(
    folder: str,
    images: Sequence[str],
    expect_warped: bool,
    manifest: Optional[dict],
) -> List[str]:
    issues: List[str] = []
    extension = None
    fronts: List[str] = []
    backs: List[str] = []

    for name in images:
        ext = Path(name).suffix.lower()
        if extension is None:
            extension = ext
        elif ext != extension:
            issues.append(f"{folder}: mixed extensions detected {extension} vs {ext}")
        stem = Path(name).stem
        if stem.startswith("FRONT_"):
            fronts.append(stem)
        elif stem.startswith("BACK_"):
            backs.append(stem)
        else:
            issues.append(f"{folder}: unexpected file name {name}")

    expected_front = set(EXPECTED_FRONT)
    expected_back = set(EXPECTED_BACK)
    if expect_warped:
        expected_front.add("FRONT_WARPED")

    missing_front = sorted(expected_front - set(fronts))
    if missing_front:
        issues.append(f"{folder}: missing front crops {missing_front}")
    missing_back = sorted(expected_back - set(backs))
    if manifest and not manifest.get("back"):
        # Singles are allowed to omit the back payload entirely.
        expected_back = set()
        missing_back = []
    if missing_back:
        issues.append(f"{folder}: missing back crops {missing_back}")

    total = len(images)
    expected_total = len(expected_front) + (len(expected_back) if expected_back else 0)
    if total != expected_total:
        issues.append(
            f"{folder}: expected {expected_total} images (front={len(expected_front)}, back={len(expected_back)}) "
            f"but found {total}"
        )
    if manifest:
        manifest_files = sorted(manifest.get("files", []))
        if manifest_files and manifest_files != sorted(images):
            issues.append(
                f"{folder}: MANIFEST.json files entry does not match directory contents"
            )
    if extension is None:
        issues.append(f"{folder}: no image files located")

    return issues


def _find_manifest(root: Path, folder: str) -> Optional[dict]:
    manifest_path = root / folder / "MANIFEST.json"
    if manifest_path.exists():
        return _load_manifest(manifest_path)
    return None


def validate_exports(
    directory: Optional[Path],
    zip_path: Optional[Path],
    expect_warped: bool,
) -> Tuple[bool, List[str]]:
    directory_files: Dict[str, List[str]] = {}
    if directory:
        if not directory.exists():
            raise ExportIssue(f"Directory export path {directory} does not exist")
        directory_files = _collect_directory(directory)

    zip_files: Dict[str, List[str]] = {}
    if zip_path:
        if not zip_path.exists():
            raise ExportIssue(f"ZIP export path {zip_path} does not exist")
        zip_files = _collect_zip(zip_path)

    issues: List[str] = []

    if directory:
        for folder, images in directory_files.items():
            manifest = _find_manifest(directory, folder)
            issues.extend(_validate_pair_images(folder or ".", images, expect_warped, manifest))

    if directory and zip_path:
        if directory_files != zip_files:
            issues.append("Directory export does not match ZIP fallback contents")
    elif zip_path:
        for folder, images in zip_files.items():
            issues.extend(_validate_pair_images(folder or ".", images, expect_warped, None))

    return (len(issues) == 0, issues)


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Validate export artifacts for QA")
    parser.add_argument("--dir-export", type=Path, help="Directory export root", default=None)
    parser.add_argument("--zip-export", type=Path, help="ZIP export fallback", default=None)
    parser.add_argument(
        "--expect-warped",
        action="store_true",
        help="Require FRONT_WARPED assets for each pair",
    )
    args = parser.parse_args(argv)

    if not args.dir_export and not args.zip_export:
        parser.error("At least one of --dir-export or --zip-export must be provided")

    try:
        ok, issues = validate_exports(args.dir_export, args.zip_export, args.expect_warped)
    except ExportIssue as exc:
        print(f"fatal: {exc}")
        return 2

    if not ok:
        print("Export validation FAILED:")
        for item in issues:
            print(f"  - {item}")
        return 1

    print("Export validation PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
