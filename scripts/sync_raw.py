#!/usr/bin/env python3
"""Sync raw source data into the repo's committed raw/ mirror.

Mirrors the source CSV layout (FTP-mockup) into the layout the dashboard
pipeline expects (raw/controller_logs + raw/telemetry). CSVs are copied only
when their content changes (sha256), so untouched files keep their mtimes and
build_dashboard_data.py's .dashboard_state.json fingerprint cache stays stable
between runs. Files that no longer exist upstream are pruned from the mirror.

SOURCE_ROOT and SOURCE_LAYOUT below (edit them when the raw source's folder
structure changes): SOURCE_ROOT is the folder inside the cloned source that
holds the layout directories; SOURCE_LAYOUT maps each source folder to the
mirror folder it lands in.
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
import sys
from pathlib import Path

SOURCE_ROOT = "FTP-mockup"

SOURCE_LAYOUT = {
    "Logs": "controller_logs",
    "Telemetry": "telemetry",
}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sync_source_to_mirror(source: Path, dest: Path) -> list[str]:
    """Copy changed CSVs from ``source`` into ``dest``, pruning removed files.

    Returns the repo-relative paths (strings) that were written or removed.
    """
    source = source.resolve()
    dest = dest.resolve()
    base = source / SOURCE_ROOT if (source / SOURCE_ROOT).is_dir() else source
    changed: list[str] = []
    seen: set[Path] = set()
    for src_subdir, dst_subdir in SOURCE_LAYOUT.items():
        src_dir = base / src_subdir
        dst_dir = dest / dst_subdir
        if not src_dir.is_dir():
            continue
        dst_dir.mkdir(parents=True, exist_ok=True)
        for src_file in sorted(src_dir.rglob("*.csv")):
            dst_file = dst_dir / src_file.relative_to(src_dir)
            seen.add(dst_file)
            if not dst_file.exists() or sha256(dst_file) != sha256(src_file):
                dst_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src_file, dst_file)
                changed.append(str(dst_file.relative_to(dest)))
    for dst_subdir in SOURCE_LAYOUT.values():
        dst_dir = dest / dst_subdir
        if not dst_dir.is_dir():
            continue
        for dst_file in sorted(dst_dir.rglob("*.csv")):
            if dst_file not in seen:
                dst_file.unlink()
                changed.append(str(dst_file.relative_to(dest)))
    return changed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source", required=True, type=Path,
        help="Cloned raw source repo root (or its data folder directly; SOURCE_ROOT/SOURCE_LAYOUT above locate the data)",
    )
    parser.add_argument(
        "--dest", required=True, type=Path,
        help="Repo raw/ mirror root",
    )
    args = parser.parse_args()
    changed = sorted(sync_source_to_mirror(args.source, args.dest))
    for rel in changed:
        print(f"synced {rel}")
    if not changed:
        print("No raw data changes.")
    sys.exit(0)


if __name__ == "__main__":
    main()