#!/usr/bin/env python3
"""Initialize a new local household. Never replace an existing ledger or configuration."""
from __future__ import annotations

import argparse
import json
from datetime import date

from household_config import ROOT, DEFAULT_CONFIG, load_config
from ledger_memory import DEFAULT_LEDGER, DEFAULT_STATE, atomic_json, digest, empty_ledger, to_app_state


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--demo", action="store_true", help="Create synthetic data in a new workspace only")
    args = parser.parse_args()
    if args.demo and (DEFAULT_LEDGER.exists() or DEFAULT_CONFIG.exists()):
        parser.exit(1, "Demo setup requires a new workspace; existing data/configuration was left intact.\n")
    for folder in ["memory", "outputs", "Finance Imports", "config"]:
        (ROOT / folder).mkdir(exist_ok=True)
    if not DEFAULT_CONFIG.exists():
        config = json.loads((ROOT / "examples/household.example.json").read_text())
        if args.demo:
            config["balance"] = {"accountId": "checking", "date": date.today().isoformat(), "amount": 4200}
        atomic_json(DEFAULT_CONFIG, config)
    config = load_config(DEFAULT_CONFIG)
    if DEFAULT_LEDGER.exists():
        print("Existing ledger and configuration preserved. Setup did not reset household data.")
        return
    ledger = empty_ledger(config)
    if args.demo:
        from convert_bank_exports import prepare_import
        today = date.today()
        month = today.strftime("%Y-%m")
        samples = [
            ("Payroll", 4000, "income", "Income", 1),
            ("Example Market", -72.50, "expense", "Groceries", min(today.day, 4)),
            ("Example Cafe", -12, "expense", "Dining", min(today.day, 8)),
            ("Example Shop refund", 15, "refund", "Shopping", min(today.day, 9)),
            ("Transfer to savings", -200, "transfer", "Transfers", min(today.day, 10)),
        ]
        rows = [{"date": f"{month}-{day:02d}", "description": name, "signedAmount": amount, "type": kind, "category": category,
                 "reference": f"demo-{i}", "source": "synthetic-demo.csv", "sourceRow": i + 2}
                for i, (name, amount, kind, category, day) in enumerate(samples)]
        ledger, report = prepare_import(ledger, config, rows, {"errors": [], "warnings": []}, "checking", digest(samples))
        if report["status"] != "pass":
            raise ValueError("Synthetic demo validation failed")
    atomic_json(DEFAULT_LEDGER, ledger)
    atomic_json(DEFAULT_STATE, to_app_state(ledger, config))
    print("Initialized synthetic demo." if args.demo else "Initialized empty household. Edit config/household.json before importing.")


if __name__ == "__main__":
    main()
