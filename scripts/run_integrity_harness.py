#!/usr/bin/env python3
"""Validate this household and bind a successful report to the exact local source files."""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

from household_config import ROOT, DEFAULT_CONFIG, load_config
from ledger_memory import DEFAULT_LEDGER, DEFAULT_STATE, atomic_json, digest, file_hash, to_app_state, utc_now, validate_ledger

REPORT = ROOT / "outputs/latest-integrity-report.json"


def code_hash() -> str:
    sources = []
    for folder in ["scripts", "harness/schemas", "web/app", "web/src", "web/db", "web/worker", "web/tests", "web/scripts", "web/drizzle"]:
        for path in sorted((ROOT / folder).rglob("*")):
            if path.is_file() and path.suffix in {".py", ".json", ".js", ".mjs", ".ts", ".tsx", ".jsx", ".css", ".sql"}:
                sources.append((str(path.relative_to(ROOT)), file_hash(path)))
    for name in ["web/package.json", "web/package-lock.json", "web/vite.config.ts", "web/wrangler.jsonc", "web/tsconfig.json", "requirements-dev.txt"]:
        sources.append((name, file_hash(ROOT / name)))
    return digest(sources)


def bindings(config_path=DEFAULT_CONFIG) -> dict:
    return {"ledgerHash": file_hash(DEFAULT_LEDGER), "stateHash": file_hash(DEFAULT_STATE), "configHash": file_hash(config_path), "codeHash": code_hash()}


def validate_current(config_path=DEFAULT_CONFIG) -> dict:
    from jsonschema import Draft202012Validator, FormatChecker
    from build_sites_import import build_accounts, build_balances, build_import_runs, build_transactions
    config = load_config(config_path)
    ledger = json.loads(DEFAULT_LEDGER.read_text())
    state = json.loads(DEFAULT_STATE.read_text())
    schema = json.loads((ROOT / "harness/schemas/ledger.schema.json").read_text())
    errors = list(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(ledger))
    if errors:
        raise ValueError("Ledger schema validation failed; first location: " + "/".join(map(str, errors[0].absolute_path)))
    validate_ledger(ledger)
    # Regeneration catches incomplete applies and configuration changes that have not been exported.
    if to_app_state(ledger, config, state["month"]) != state:
        raise ValueError("App state is stale or differs from the canonical ledger/configuration; regenerate by preview/apply")
    transactions = build_transactions(ledger)
    if len(transactions) != len(ledger["transactions"]):
        raise ValueError("Snapshot dropped transactions")
    return {"accounts": len(build_accounts(ledger)), "transactions": len(transactions),
            "balanceSnapshots": len(build_balances(ledger)), "importRuns": len(build_import_runs(ledger)),
            "transactionAmountCents": sum(row["amountCents"] for row in transactions)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--full", action="store_true", help="Also run TypeScript checks and a production build")
    args = parser.parse_args()
    start = bindings(args.config)
    checks, expected = [], None
    try:
        expected = validate_current(args.config)
        checks.append({"name": "Ledger schema, identity, state and snapshot reconciliation", "status": "pass"})
    except (ValueError, OSError, KeyError, ImportError) as exc:
        checks.append({"name": "Ledger validation", "status": "fail", "reason": str(exc)})
    commands = [([sys.executable, "-m", "unittest", "discover", "-s", "scripts", "-p", "test_*.py"], ROOT),
                (["npm", "test"], ROOT / "web")]
    if args.full:
        commands.extend([(["npm", "run", "typecheck"], ROOT / "web"), (["npm", "run", "build"], ROOT / "web")])
    for command, cwd in commands:
        try:
            result = subprocess.run(command, cwd=cwd, check=False)
            checks.append({"name": " ".join(command[1:] if command[0] == sys.executable else command), "status": "pass" if result.returncode == 0 else "fail"})
        except OSError:
            checks.append({"name": " ".join(command[1:]), "status": "fail", "reason": "Required runtime is unavailable"})
    if start != bindings(args.config):
        checks.append({"name": "Sources unchanged during validation", "status": "fail"})
    status = "pass" if checks and all(row["status"] == "pass" for row in checks) else "fail"
    atomic_json(REPORT, {"generatedAt": utc_now(), "status": status, "mode": "full" if args.full else "standard", **start, "expected": expected, "checks": checks})
    print(f"Integrity {status.upper()}. See outputs/latest-integrity-report.json.")
    raise SystemExit(0 if status == "pass" else 1)


if __name__ == "__main__":
    main()
