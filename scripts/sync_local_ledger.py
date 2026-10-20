#!/usr/bin/env python3
"""Stage, reconcile, activate, and verify the local serving copy. Never connects off loopback."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from household_config import ROOT, DEFAULT_CONFIG
from run_integrity_harness import REPORT, bindings


def validate_url(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "http" or parsed.hostname not in {"127.0.0.1", "localhost", "::1"} or parsed.username or parsed.password or parsed.path not in {"", "/"} or parsed.query or parsed.fragment:
        raise ValueError("Local sync requires an http loopback URL with no path, credentials, query, or fragment")
    if parsed.port is None:
        raise ValueError("Specify the local server port explicitly")
    return value.rstrip("/")


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, file, code, message, headers, url):
        raise ValueError("Redirect refused: ledger sync stays on the requested loopback server")


class LocalClient:
    def __init__(self, url: str):
        self.url = validate_url(url)
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirects())

    def call(self, path: str, method="GET", body=None):
        payload = json.dumps(body, allow_nan=False).encode() if body is not None else None
        request = urllib.request.Request(self.url + path, data=payload, method=method, headers={"content-type": "application/json"})
        try:
            with self.opener.open(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            raise ValueError(f"Local API refused {method} {path} with status {exc.code}") from None


def require_report(config_path=DEFAULT_CONFIG):
    report = json.loads(REPORT.read_text())
    if report.get("status") != "pass" or any(report.get(key) != value for key, value in bindings(config_path).items()):
        raise ValueError("Integrity report is stale or failed. Run scripts/run_integrity_harness.py first.")
    return report


def publish(client: LocalClient, bundle: dict) -> dict:
    start = client.call("/api/admin/imports/start", "POST", {key: bundle[key] for key in ["schemaVersion", "sourceHash", "createdAt", "state", "expected"]})
    snapshot = start["snapshotId"]
    committed = False
    try:
        for entity in ["accounts", "transactions", "balanceSnapshots", "importRuns"]:
            for offset in range(0, len(bundle[entity]), 100):
                client.call(f"/api/admin/imports/{snapshot}/chunk", "POST", {"entity": entity, "rows": bundle[entity][offset:offset + 100]})
        client.call(f"/api/admin/imports/{snapshot}/commit", "POST")
        committed = True
    finally:
        if not committed:
            try:
                client.call(f"/api/admin/imports/{snapshot}", "DELETE")
            except Exception:
                print("Rollback could not be confirmed; inspect the local staging snapshot before retrying.", file=sys.stderr)
    status = client.call("/api/admin/sync-status")
    if not status.get("active") or status.get("sourceHash") != bundle["sourceHash"] or status.get("actual") != bundle["expected"] or status.get("expected") != bundle["expected"]:
        raise ValueError("Active snapshot verification failed; do not call this import complete")
    return status


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:4310")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    args = parser.parse_args()
    try:
        client = LocalClient(args.url)
        report = require_report(args.config)
        subprocess.run([sys.executable, str(ROOT / "scripts/build_sites_import.py")], check=True)
        bundle = json.loads((ROOT / "outputs/finance-sites-import.json").read_text())
        # Catch concurrent changes between report validation and bundle construction.
        require_report(args.config)
        if bundle["expected"] != report["expected"]:
            raise ValueError("Bundle totals differ from the successful integrity run")
        status = publish(client, bundle)
        require_report(args.config)
        from ledger_memory import atomic_json
        atomic_json(ROOT / "outputs/latest-local-sync-status.json", status)
        print("Local snapshot activated and source hash/totals verified. Confirm the imported period in the dashboard.")
    except (ValueError, OSError, KeyError, subprocess.CalledProcessError) as exc:
        parser.exit(1, f"Sync stopped: {exc}\n")


if __name__ == "__main__":
    main()
