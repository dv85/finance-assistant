#!/usr/bin/env python3
"""Export only reviewed public source files. Runtime data and dependencies are never archived."""
from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path

from household_config import ROOT
from public_release import audit


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "release/finance-assistant-0.1.0-source.zip")
    args = parser.parse_args()
    files, findings = audit()
    if findings:
        print(json.dumps({"findings": findings}, indent=2))
        parser.exit(1, "Publication-set privacy checks failed; archive was not created.\n")
    output = args.output.resolve()
    if output.exists() or output in [path.resolve() for path in files]:
        parser.exit(1, "Output already exists or overlaps a source file; choose a new archive path.\n")
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            info = zipfile.ZipInfo("finance-assistant/" + path.relative_to(ROOT).as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())
    # Verify the resulting archive rather than assuming write success establishes scope.
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() or sorted(archive.namelist()) != sorted("finance-assistant/" + path.relative_to(ROOT).as_posix() for path in files):
            raise ValueError("Source archive verification failed")
    print(json.dumps({"files": len(files), "sha256": hashlib.sha256(output.read_bytes()).hexdigest(), "output": str(output.relative_to(ROOT)) if output.is_relative_to(ROOT) else output.name}, indent=2))


if __name__ == "__main__":
    main()
