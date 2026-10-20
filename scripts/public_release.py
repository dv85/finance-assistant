"""Explicit publication-set validation and value-redacting privacy checks."""
from __future__ import annotations

import json
import re
from pathlib import Path, PurePosixPath

from household_config import ROOT

FORBIDDEN = {".git", ".venv", "node_modules", "memory", "outputs", "Finance Imports", "config", ".wrangler", ".next", ".vinext", "dist", ".playwright-cli", "__pycache__", "validation", "release", "semantic-layers"}
PATTERNS = {
    "private-key": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "credential-pattern": re.compile(r"\b(?:sk-[A-Za-z0-9_-]{24,}|gh[pousr]_[A-Za-z0-9_]{24,}|github_pat_[A-Za-z0-9_]{24,}|AKIA[A-Z0-9]{16})\b"),
    "jwt-pattern": re.compile(r"\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}"),
    "private-local-path": re.compile(r"/(?:Users|home)/[a-zA-Z0-9_.-]+/"),
    "private-hosting-id": re.compile(r"appgprj_[a-z0-9]{12,}"),
    "private-workbook": re.compile(r"docs[.]google[.]com/spreadsheets/d/[A-Za-z0-9_-]{16,}"),
    "private-hosting-domain": re.compile(r"git[.]chatgpt-team[.]site"),
}


def public_files(root: Path = ROOT) -> list[Path]:
    names = json.loads((root / "PUBLIC_FILES.json").read_text())
    if not isinstance(names, list) or not names or len(names) != len(set(names)):
        raise ValueError("Publication manifest must be a nonempty unique list")
    files = []
    for name in names:
        if not isinstance(name, str) or "\\" in name:
            raise ValueError("Publication paths must be POSIX strings")
        relative = PurePosixPath(name)
        if relative.is_absolute() or ".." in relative.parts or not relative.parts or any(part in FORBIDDEN for part in relative.parts):
            raise ValueError("Private or unsafe path in publication manifest")
        if relative.name.startswith((".env", ".dev.vars")) or relative.suffix.lower() in {".pem", ".key", ".p12", ".pfx", ".db", ".sqlite", ".sqlite3", ".pyc"}:
            raise ValueError("Sensitive file type in publication manifest")
        path = root.joinpath(*relative.parts)
        cursor = root
        for part in relative.parts:
            cursor = cursor / part
            if cursor.is_symlink():
                raise ValueError("Publication files must not use symlinks")
        if not path.is_file() or not path.resolve().is_relative_to(root.resolve()):
            raise ValueError("Missing or out-of-tree publication file")
        files.append(path)
    return files


def audit(root: Path = ROOT) -> tuple[list[Path], list[dict]]:
    files, findings = public_files(root), []
    for path in files:
        data = path.read_bytes()
        try:
            text = data.decode("utf-8")
        except UnicodeDecodeError:
            # Binary additions require deliberate review, not a text-scan exemption.
            findings.append({"file": path.relative_to(root).as_posix(), "rule": "unreviewed-binary"})
            continue
        for number, line in enumerate(text.splitlines(), 1):
            if path.suffix == ".sql" and re.match(r"\s*(?:INSERT|REPLACE|UPDATE|DELETE)\b", line, re.I):
                findings.append({"file": path.relative_to(root).as_posix(), "line": number, "rule": "migration-seed-data"})
            for rule, pattern in PATTERNS.items():
                if pattern.search(line):
                    findings.append({"file": path.relative_to(root).as_posix(), "line": number, "rule": rule})
    return files, findings


if __name__ == "__main__":
    try:
        files, findings = audit()
        print(json.dumps({"files": len(files), "findings": findings}, indent=2))
        raise SystemExit(1 if findings else 0)
    except (ValueError, OSError) as exc:
        raise SystemExit(f"Public audit stopped: {exc}")
