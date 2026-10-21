#!/usr/bin/env python3
"""Preview-first CSV/XLSX imports. Applying always reparses current sources and rules."""
from __future__ import annotations

import argparse
import copy
import json
from collections import Counter
from datetime import date
from pathlib import Path

from household_config import ROOT, DEFAULT_CONFIG, account_for, load_config, money
from import_formats import FORMATS, csv_rows, load_mapping, xlsx_rows
from installment_plans import enrich_installment_plans
from ledger_memory import DEFAULT_LEDGER, DEFAULT_STATE, TYPES, atomic_json, digest, file_hash, load_ledger, to_app_state, utc_now, validate_ledger


def normalize_row(raw: dict, config: dict, default_account: str | None, occurrence: int) -> dict:
    account_id = raw.get("account") or default_account
    account = account_for(config, account_id)
    if raw.get("currency", config["currency"]) not in {"", config["currency"]}:
        raise ValueError("Row currency differs from the base currency; automatic FX is unsupported")
    amount = money(abs(raw["signedAmount"]))
    if not amount:
        raise ValueError("Zero amounts are not imported; remove non-movement rows explicitly")
    description = str(raw.get("description", "")).strip()
    if not description:
        raise ValueError("Description is required")
    date.fromisoformat(raw["date"])
    rule = next((item for item in config.get("rules", []) if item["contains"].casefold() in description.casefold()), {})
    incoming = raw["signedAmount"] > 0
    kind = raw.get("type") or rule.get("type") or ("refund" if incoming and account["type"] == "credit_card" else "income" if incoming else "expense")
    if kind not in TYPES:
        raise ValueError("Unsupported transaction type; map it to a documented type")
    if kind in {"income", "refund"} and not incoming:
        raise ValueError("Income/refund must use the inflow side of the configured sign convention")
    if kind in {"expense", "fee", "card_settlement", "cash_withdrawal"} and incoming:
        raise ValueError("Expenses/fees/settlements/withdrawals must use the outflow side")
    category = raw.get("category") or rule.get("category") or ("Income" if kind == "income" else "Transfers" if kind in {"transfer", "card_settlement"} else "Cash" if kind == "cash_withdrawal" else "Other")
    merchant = rule.get("merchant") or description
    installment = bool(raw.get("isInstallment")) and kind != "refund"
    billing = raw.get("billingDate") or None
    if billing:
        date.fromisoformat(billing)
    if installment and not billing:
        raise ValueError("An explicitly marked installment needs a billingDate")
    number, count = raw.get("installmentNumber"), raw.get("installmentCount")
    if bool(number) != bool(count) or (number and (not installment or not 1 <= number <= count <= 120)):
        raise ValueError("Installment number/count must be supplied together on an installment and be in range")
    total = money(raw.get("purchaseAmount") or amount)
    if installment and total < amount:
        raise ValueError("Purchase total cannot be smaller than the billed portion")
    reference = str(raw.get("reference") or "").strip()
    identity = [account_id, raw["date"], description.casefold(), amount, incoming, kind, billing, installment, reference, number]
    if not reference:
        identity.append(occurrence)
    fingerprint = digest(identity)
    now = utc_now()
    row = {
        "id": "tx-" + fingerprint[:24], "fingerprint": fingerprint, "account_id": account_id,
        "date": raw["date"], "description": description, "merchant": merchant,
        "normalizedMerchantName": merchant, "merchantDescription": rule.get("description") or f"{category} transaction; review the statement descriptor.",
        "merchantProfileReviewed": bool(rule.get("merchant")), "merchantReviewRequired": not bool(rule.get("merchant")),
        "merchantDescriptionSource": "manual" if rule.get("merchant") else "category_fallback",
        "amount": amount, "currency": config["currency"], "direction": "inflow" if incoming else "outflow",
        "type": kind, "category": category, "categoryReviewed": bool(raw.get("category") or rule),
        "source": raw["source"], "sourceRefs": [{"label": f"{raw['source']}: row {raw['sourceRow']}", "firstSeenAt": now}],
        "reference": reference, "isInstallment": installment, "createdAt": now, "updatedAt": now,
    }
    if billing:
        row["billingDate"] = billing
    if installment:
        row["purchaseAmount"] = total
        row["creditTransactionType"] = raw.get("creditTransactionType") or "explicit installment"
        if number:
            # The existing planner understands explicit ordinals without inventing a count.
            row["reference"] = f"{reference} installment {number} of {count}".strip()
    return row


def prepare_import(ledger: dict, config: dict, rows: list[dict], audit: dict, account_id: str | None, source_hash: str) -> tuple[dict, dict]:
    candidate = copy.deepcopy(ledger)
    by_fingerprint = {row["fingerprint"]: row for row in candidate["transactions"]}
    occurrences, inserted, duplicates = Counter(), 0, 0
    errors = list(audit["errors"])
    warnings = list(audit.get("warnings", []))
    for raw in rows:
        identity = {key: value for key, value in raw.items() if key not in {"source", "sourceRow", "balance", "lastBalanceOnDate"}}
        key = digest(identity)
        occurrences[key] += 1
        try:
            row = normalize_row(raw, config, account_id, occurrences[key])
            existing = by_fingerprint.get(row["fingerprint"])
            if existing:
                duplicates += 1
                labels = {item["label"] for item in existing["sourceRefs"]}
                existing["sourceRefs"].extend(item for item in row["sourceRefs"] if item["label"] not in labels)
            else:
                candidate["transactions"].append(row)
                by_fingerprint[row["fingerprint"]] = row
                inserted += 1
            if not row["categoryReviewed"] and row["type"] not in {"income", "transfer", "card_settlement"}:
                warnings.append({"row": raw["sourceRow"], "warning": "Category is a fallback. Review and add a config rule or CSV category if needed."})
            if "balance" in raw:
                balance_id = "balance-" + digest([row["account_id"], row["date"]])[:24]
                snapshot = {"id": balance_id, "fingerprint": balance_id, "account_id": row["account_id"], "date": row["date"],
                            "observed_balance": money(raw["balance"]), "currency": config["currency"],
                            "createdAt": row["createdAt"], "updatedAt": row["updatedAt"], "source": raw["source"]}
                # Use the final chronological row on a date. Adapters attach rank below.
                if raw.get("lastBalanceOnDate", True):
                    candidate["balanceSnapshots"] = [item for item in candidate["balanceSnapshots"] if item["id"] != balance_id] + [snapshot]
        except (ValueError, TypeError, KeyError) as exc:
            errors.append({"row": raw.get("sourceRow"), "error": str(exc)})
    configured = config.get("balance")
    if configured:
        ident = "configured-balance-" + digest([configured["accountId"], configured["date"]])[:24]
        existing_balance = next((item for item in candidate["balanceSnapshots"] if item["id"] == ident), None)
        if existing_balance:
            if existing_balance["observed_balance"] != configured["amount"] or existing_balance["currency"] != config["currency"]:
                existing_balance.update(observed_balance=configured["amount"], currency=config["currency"], updatedAt=utc_now())
        else:
            now = utc_now()
            candidate["balanceSnapshots"].append({"id": ident, "fingerprint": ident, "account_id": configured["accountId"],
                "date": configured["date"], "observed_balance": configured["amount"], "currency": config["currency"], "createdAt": now, "updatedAt": now})
    if not rows and not errors:
        errors.append({"error": "The source contains no transaction rows"})
    candidate["transactions"].sort(key=lambda row: (row["date"], row["id"]))
    # Cash movements are a separate account view; settlements/transfers never become spending.
    candidate["cashMovements"] = []
    for row in candidate["transactions"]:
        if account_for(config, row["account_id"])["type"] == "credit_card":
            continue
        movement_type = {"income": "bank_credit", "card_settlement": "card_settlement", "transfer": "transfer",
                         "cash_withdrawal": "cash_withdrawal", "fee": "fee"}.get(row["type"], "direct_expense")
        candidate["cashMovements"].append({"id": "cash-" + row["id"], "fingerprint": row["fingerprint"], "account_id": row["account_id"],
            "date": row["date"], "description": row["description"], "amount": row["amount"], "currency": row["currency"],
            "direction": row["direction"], "movementType": movement_type, "sourceRefs": row["sourceRefs"],
            "createdAt": row["createdAt"], "updatedAt": row["updatedAt"]})
    enrich_installment_plans(candidate)
    try:
        validate_ledger(candidate)
    except ValueError as exc:
        errors.append({"error": str(exc)})
    if inserted:
        candidate["importRuns"].append({"id": "import-" + source_hash[:24], "source": "Local file import", "status": "completed",
            "importedAt": utc_now(), "transactionCount": inserted, "duplicateCount": duplicates, "warningCount": len(warnings)})
    return candidate, {"status": "fail" if errors else "pass", "parsedRows": len(rows), "inserted": inserted, "duplicates": duplicates,
                       "blankRows": audit.get("blankRows", 0), "errors": errors, "warnings": warnings}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--format", choices=sorted(FORMATS), required=True)
    parser.add_argument("--mapping", type=Path, help="Saved CSV column mapping; required for CSV")
    parser.add_argument("--account", help="Configured account id, unless mapped per CSV row")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--month", help="Initial dashboard month (YYYY-MM); defaults to the current month")
    parser.add_argument("--bank-order", choices=["newest-first", "oldest-first"], default="newest-first")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    try:
        config = load_config(args.config)
        if args.format == "csv":
            if not args.mapping:
                raise ValueError("CSV imports require --mapping")
            mapping = load_mapping(args.mapping)
            rows, audit = csv_rows(args.input, mapping)
        else:
            if args.mapping:
                raise ValueError("--mapping applies to CSV imports only")
            if not args.account:
                raise ValueError("XLSX imports require --account")
            rows, audit = xlsx_rows(args.input, args.format, config, args.bank_order)
            if args.format == "israeli-bank":
                ordered = list(reversed(rows)) if args.bank_order == "newest-first" else rows
                for row in rows:
                    row["lastBalanceOnDate"] = row is [item for item in ordered if item["date"] == row["date"]][-1]
        ledger = load_ledger(DEFAULT_LEDGER, config)
        source_hash = file_hash(args.input)
        seal = digest({"source": source_hash, "name": args.input.name, "ledger": file_hash(DEFAULT_LEDGER),
                       "config": file_hash(args.config), "mapping": file_hash(args.mapping) if args.mapping else None,
                       "format": args.format, "account": args.account, "month": args.month, "bankOrder": args.bank_order,
                       "code": {p.name: file_hash(p) for p in sorted((ROOT / "scripts").glob("*.py"))}})
        candidate, report = prepare_import(ledger, config, rows, audit, args.account, source_hash)
        state = to_app_state(candidate, config, args.month)
        preview_path = ROOT / "outputs/latest-import-preview.json"
        if args.apply:
            if not preview_path.exists():
                raise ValueError("Preview first, review outputs/latest-import-preview.json, then repeat with --apply")
            previous = json.loads(preview_path.read_text())
            if previous.get("inputsHash") != seal or previous.get("status") != "pass" or report["status"] != "pass":
                raise ValueError("Preview is stale or failed. Preview again and resolve errors before applying.")
            atomic_json(DEFAULT_LEDGER, candidate)
            atomic_json(DEFAULT_STATE, state)
        else:
            atomic_json(preview_path, {**report, "inputsHash": seal, "source": args.input.name,
                                      "review": [{key: row.get(key) for key in ["id", "date", "description", "amount", "direction", "type", "category", "account_id", "isInstallment"]} for row in candidate["transactions"]]})
        print(json.dumps({"mode": "applied" if args.apply else "preview", **{key: report[key] for key in ["status", "parsedRows", "inserted", "duplicates"]},
                          "errors": len(report["errors"]), "warnings": len(report["warnings"])}))
        if report["status"] != "pass":
            raise SystemExit(1)
    except (ValueError, OSError, KeyError, csv_error()) as exc:
        parser.exit(1, f"Import stopped: {exc}\n")


def csv_error():
    import csv
    return csv.Error


if __name__ == "__main__":
    main()
