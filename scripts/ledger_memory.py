"""Canonical ledger and app state, independent of a particular household."""
from __future__ import annotations

import copy
import hashlib
import json
import os
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path

from household_config import ROOT, money

DEFAULT_LEDGER = ROOT / "memory/ledger.json"
DEFAULT_STATE = ROOT / "outputs/latest-import.json"
TYPES = {"expense", "income", "refund", "transfer", "card_settlement", "cash_withdrawal", "fee"}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def digest(value) -> str:
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def file_hash(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.exists() else "missing"


def empty_ledger(config: dict) -> dict:
    return {
        "schemaVersion": 2, "currency": config["currency"],
        "transactions": [], "cardAllocations": [], "cashMovements": [], "balanceSnapshots": [],
        "importRuns": [], "categoryRules": copy.deepcopy(config.get("rules", [])), "merchantProfiles": [],
        "accounts": copy.deepcopy(config["accounts"]), "recurringCosts": copy.deepcopy(config.get("recurringCosts", [])),
    }


def load_ledger(path: Path, config: dict) -> dict:
    ledger = json.loads(path.read_text(encoding="utf-8")) if path.exists() else empty_ledger(config)
    if ledger.get("currency") != config["currency"]:
        raise ValueError("Changing the currency of an existing ledger would relabel money. Start a separate workspace instead.")
    ledger["accounts"] = copy.deepcopy(config["accounts"])
    ledger["categoryRules"] = copy.deepcopy(config.get("rules", []))
    ledger["recurringCosts"] = copy.deepcopy(config.get("recurringCosts", []))
    return ledger


def atomic_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=".finance-", suffix=".tmp")
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def to_app_state(ledger: dict, config: dict, month: str | None = None) -> dict:
    month = month or date.today().strftime("%Y-%m")
    if len(month) != 7 or date.fromisoformat(month + "-01").strftime("%Y-%m") != month:
        raise ValueError("Month must be YYYY-MM")
    configured_balance = config.get("balance")
    bank_accounts = [row["id"] for row in config["accounts"] if row["type"] == "bank_account"]
    # With multiple bank accounts, require an explicit selection rather than
    # substituting whichever account happened to be imported most recently.
    balance_account = configured_balance["accountId"] if configured_balance else (
        bank_accounts[0] if len(bank_accounts) == 1 else None
    )
    balances = [{"date": row["date"], "amount": row["observed_balance"]}
                for row in ledger.get("balanceSnapshots", []) if row["account_id"] == balance_account]
    if configured_balance:
        balances.append({"date": configured_balance["date"], "amount": configured_balance["amount"]})
    # An explicit configuration correction wins a tie on the observation date.
    balance = sorted(balances, key=lambda row: row["date"])[-1] if balances else None
    incomes = [{"id": row["id"], "name": row["description"], "amount": row["amount"], "date": row["date"],
                "paidDate": row["date"], "budgetMonth": row["date"][:7], "paid": True, "received": True,
                "source": row["description"], "sourceRef": row.get("source", "Import"), "actualDate": row["date"]}
               for row in ledger["transactions"] if row["type"] == "income"]
    return {
        "currency": config["currency"], "month": month, "openingBalance": config["openingBalance"],
        "bufferTarget": config["bufferTarget"], "savingsGoal": 0, "accountBalance": balance,
        "income": [row for row in incomes if row["budgetMonth"] == month], "incomeHistory": incomes,
        "categories": copy.deepcopy(config.get("categories", [])), "fixed": [], "debts": [], "subs": [],
        "evidence": [], "actions": [], "monthlyStatus": [],
        "transactions": copy.deepcopy(ledger["transactions"]),
        "cardAllocations": copy.deepcopy(ledger.get("cardAllocations", [])),
        "cashMovements": copy.deepcopy(ledger.get("cashMovements", [])),
    }


def validate_ledger(ledger: dict) -> None:
    currency = ledger["currency"]
    accounts = {row["id"] for row in ledger["accounts"]}
    ids, fingerprints = set(), set()
    for row in ledger["transactions"]:
        if row["id"] in ids or row["fingerprint"] in fingerprints:
            raise ValueError("Duplicate transaction identity in ledger")
        ids.add(row["id"]); fingerprints.add(row["fingerprint"])
        date.fromisoformat(row["date"])
        if row["account_id"] not in accounts or row["currency"] != currency:
            raise ValueError("Transaction account or currency does not match household configuration")
        if row["type"] not in TYPES or row["direction"] not in {"inflow", "outflow"}:
            raise ValueError("Unsupported transaction type or direction")
        amount = money(row["amount"])
        if amount <= 0:
            raise ValueError("Canonical transaction amounts must be positive; use direction/type for credits")
        if row.get("isInstallment"):
            if not row.get("billingDate"):
                raise ValueError("Installments need an explicit billing date")
            date.fromisoformat(row["billingDate"])
    for row in ledger.get("balanceSnapshots", []):
        date.fromisoformat(row["date"])
        money(row["observed_balance"])
        if row["account_id"] not in accounts or row["currency"] != currency:
            raise ValueError("Balance account or currency does not match household configuration")
