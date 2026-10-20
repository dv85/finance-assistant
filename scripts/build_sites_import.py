#!/usr/bin/env python3
"""Build a reconciled snapshot for the local finance dashboard or an explicitly configured site."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from installment_plans import enrich_installment_plans


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LEDGER = ROOT / "memory" / "ledger.json"
DEFAULT_STATE = ROOT / "outputs" / "latest-import.json"
DEFAULT_OUTPUT = ROOT / "outputs" / "finance-sites-import.json"


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def cents(value: Any) -> int:
    return round(float(value or 0) * 100)


def source_id(row: dict[str, Any], prefix: str, index: int) -> str:
    value = row.get("sourceId") or row.get("source_id") or row.get("id") or row.get("fingerprint")
    return str(value or f"{prefix}-{index}")


def reporting_date(row: dict[str, Any]) -> str:
    purchase = str(row.get("date") or row.get("transactionDate") or row.get("transaction_date") or "")
    installment = bool(row.get("isInstallment") or row.get("is_installment"))
    if installment:
        return str(row.get("billingDate") or row.get("billing_date") or purchase)
    return purchase


def compact_state(state: dict[str, Any]) -> dict[str, Any]:
    keep = (
        "currency", "month", "openingBalance", "bufferTarget", "savingsGoal", "accountBalance",
        "categories", "income", "incomeHistory", "fixed", "debts", "subs", "evidence", "actions", "monthlyStatus",
    )
    return {key: state[key] for key in keep if key in state}


def build_accounts(ledger: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for index, row in enumerate(ledger.get("accounts", [])):
        rows.append({
            "sourceId": source_id(row, "account", index),
            "name": str(row.get("name") or "Account"),
            "type": str(row.get("type") or "account"),
            "currency": str(row.get("currency") or ledger.get("currency") or "ILS"),
            "provider": row.get("provider"),
            "cardLast4": row.get("cardLast4") or row.get("card_last4"),
            "payload": {key: row[key] for key in ("status", "matchHints", "match_hints") if key in row},
        })
    return rows


def build_transactions(ledger: dict[str, Any]) -> list[dict[str, Any]]:
    enrich_installment_plans(ledger)
    rows = []
    for index, row in enumerate(ledger.get("transactions", [])):
        purchase_date = str(row.get("date") or row.get("transactionDate") or row.get("transaction_date") or "")
        report_date = reporting_date(row)
        if not purchase_date or not report_date:
            raise ValueError(f"Transaction {index} is missing a reporting date")
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        rows.append({
            "sourceId": source_id(row, "transaction", index),
            "fingerprint": row.get("fingerprint"),
            "transactionDate": purchase_date,
            "billingDate": row.get("billingDate") or row.get("billing_date"),
            "reportingDate": report_date,
            "isInstallment": bool(row.get("isInstallment") or row.get("is_installment")),
            "description": str(row.get("description") or row.get("merchant") or "Transaction"),
            "merchant": row.get("merchant"),
            "normalizedMerchantName": row.get("normalizedMerchantName") or metadata.get("normalizedMerchantName"),
            "merchantDescription": row.get("merchantDescription") or metadata.get("merchantDescription"),
            "amountCents": cents(row.get("amount")),
            "currency": str(row.get("currency") or ledger.get("currency") or "ILS"),
            "direction": str(row.get("direction") or "outflow"),
            "type": str(row.get("type") or "expense"),
            "category": str(row.get("category") or "Other"),
            "costLabel": row.get("costLabel") or row.get("cost_label"),
            "sourceLabel": row.get("sourceLabel") or row.get("source_label") or row.get("source"),
            "metadata": {
                **{key: row[key] for key in (
                    "account_id", "accountId", "purchaseAmount", "reference", "installmentReference",
                    "installmentPlanId", "installmentNumber", "installmentCount", "isPending", "amountEstimated", "creditTransactionType",
                    "recurringCostId", "recurringCadence", "recurringReviewed", "categoryReviewed", "categoryRuleId"
                ) if key in row},
                **{key: value for key, value in {
                    "merchantProfileId": row.get("merchantProfileId") or metadata.get("merchantProfileId"),
                    "merchantProfileReviewed": row.get("merchantProfileReviewed", metadata.get("merchantProfileReviewed")),
                    "merchantReviewRequired": row.get("merchantReviewRequired", metadata.get("merchantReviewRequired")),
                }.items() if value is not None},
            },
        })
    return rows


def build_balances(ledger: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for index, row in enumerate(ledger.get("balanceSnapshots", [])):
        date = str(row.get("date") or row.get("snapshotDate") or row.get("snapshot_date") or "")
        if not date:
            raise ValueError(f"Balance snapshot {index} is missing a date")
        rows.append({
            "sourceId": source_id(row, "balance", index),
            "snapshotDate": date,
            "observedBalanceCents": cents(row.get("observedBalance", row.get("observed_balance"))),
            "currency": str(row.get("currency") or ledger.get("currency") or "ILS"),
            "payload": {key: row[key] for key in ("source", "note", "accountId", "account_id") if key in row},
        })
    return rows


def build_import_runs(ledger: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for index, row in enumerate(ledger.get("importRuns", [])):
        rows.append({
            "sourceId": source_id(row, "import", index),
            "label": str(row.get("label") or row.get("source") or "Import run"),
            "status": str(row.get("status") or "completed"),
            "importedAt": row.get("importedAt") or row.get("createdAt") or row.get("created_at"),
            "transactionCount": int(row.get("transactionCount") or 0),
            "warningCount": int(row.get("warningCount") or 0),
            "payload": {key: row[key] for key in ("sourceFiles", "duplicateCount", "qa") if key in row},
        })
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ledger", default=str(DEFAULT_LEDGER))
    parser.add_argument("--state", default=str(DEFAULT_STATE))
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()

    ledger_path = Path(args.ledger).expanduser().resolve()
    state_path = Path(args.state).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    ledger = load_json(ledger_path)
    state = load_json(state_path)
    accounts = build_accounts(ledger)
    transactions = build_transactions(ledger)
    balances = build_balances(ledger)
    imports = build_import_runs(ledger)
    source_hash = hashlib.sha256(ledger_path.read_bytes() + b"\0" + state_path.read_bytes()).hexdigest()
    expected = {
        "accounts": len(accounts),
        "transactions": len(transactions),
        "balanceSnapshots": len(balances),
        "importRuns": len(imports),
        "transactionAmountCents": sum(row["amountCents"] for row in transactions),
    }
    bundle = {
        "schemaVersion": "finance-sites-import/v1",
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "sourceHash": source_hash,
        "state": {
            **compact_state(state),
            "installmentPlans": ledger.get("installmentPlans", []),
            "recurringCosts": ledger.get("recurringCosts", []),
        },
        "accounts": accounts,
        "transactions": transactions,
        "balanceSnapshots": balances,
        "importRuns": imports,
        "expected": expected,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(bundle, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"output": str(output_path), "bytes": output_path.stat().st_size, "expected": expected}, indent=2))


if __name__ == "__main__":
    main()
