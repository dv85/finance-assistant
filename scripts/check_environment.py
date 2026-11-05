#!/usr/bin/env python3
"""Check local prerequisites without installing dependencies or opening household data."""
from __future__ import annotations

import re
import shutil
import subprocess
import sys


TIMEOUT_SECONDS = 10
NODE_VERSION = re.compile(r"v([0-9]+)\.[0-9]+\.[0-9]+")
NODE_HELP = "Make Node.js 24 available on PATH, then rerun this check."
NPM_HELP = "Make npm available on PATH (normally included with Node.js), then rerun this check."


def probe_version(label: str, command: list[str], pattern: re.Pattern, remedy: str) -> str | None:
    """Run a version query only; never reproduce arbitrary command output."""
    try:
        result = subprocess.run(
            command, shell=False, stdin=subprocess.DEVNULL, capture_output=True,
            text=True, encoding="utf-8", errors="replace", timeout=TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        print(f"FAIL {label}: version query timed out after {TIMEOUT_SECONDS}s. Check the tool manually. {remedy}")
        return None
    except FileNotFoundError:
        print(f"FAIL {label}: command not found or no longer available. {remedy}")
        return None
    except OSError as exc:
        print(f"FAIL {label}: could not start version query ({type(exc).__name__}). Check execution permissions. {remedy}")
        return None
    if result.returncode != 0:
        print(f"FAIL {label}: version query exited with status {result.returncode}. Check the tool manually. {remedy}")
        return None
    version = result.stdout.strip()
    if not pattern.fullmatch(version):
        print(f"FAIL {label}: version query returned an unrecognized version. {remedy}")
        return None
    return version


def check_node(node: str | None) -> bool:
    if node is None:
        print(f"FAIL Node.js: command not found. {NODE_HELP}")
        return False
    version = probe_version("Node.js", [node, "--version"], NODE_VERSION, NODE_HELP)
    if version is None:
        return False
    major = NODE_VERSION.fullmatch(version).group(1)
    if major != "24":
        print(f"FAIL Node.js: {version} (major {major}); required major 24. {NODE_HELP}")
        return False
    print(f"OK Node.js: {version} (major 24)")
    return True


def check_npm(npm: str | None) -> bool:
    if npm is None:
        print(f"FAIL npm: command not found. {NPM_HELP}")
        return False
    # Only availability is required. Even `npm --version` can load .npmrc
    # credentials; do not launch npm or read its configuration for this check.
    print("OK npm: available on PATH (presence only; npm is not executed)")
    return True


def main() -> int:
    python_version = ".".join(str(part) for part in sys.version_info[:2])
    python_ok = sys.version_info[:2] == (3, 12)
    if python_ok:
        print(f"OK Python: {python_version} (running interpreter)")
    else:
        print(f"FAIL Python: {python_version}; required 3.12. Rerun with python3.12, or py -3.12 on Windows.")
    node = shutil.which("node")
    npm = shutil.which("npm")
    node_ok = check_node(node)
    npm_ok = check_npm(npm)
    if not all((python_ok, node_ok, npm_ok)):
        print("Prerequisites failed. Resolve each FAIL above before following README setup.")
        return 1
    print("Prerequisites passed. This does not validate app setup or end-to-end OS support.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
