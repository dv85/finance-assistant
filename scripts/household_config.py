"""Private household configuration. Examples contain synthetic values only."""
from __future__ import annotations

import copy
import json
import re
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "config/household.json"
CURRENCIES = {"USD", "EUR", "GBP", "ILS"}


def money(value) -> float:
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("Money must be a finite decimal number") from exc
    if not number.is_finite() or abs(number) > 1_000_000_000 or number != number.quantize(Decimal("0.01")):
        raise ValueError("Money must be finite, have at most two decimals, and be within supported bounds")
    return float(number)


def load_config(path: Path = DEFAULT_CONFIG) -> dict:
    if not path.is_file():
        raise ValueError("Missing household config. Run scripts/setup_local.py first.")
    config = copy.deepcopy(json.loads(path.read_text(encoding="utf-8")))
    if not isinstance(config, dict) or config.get("schemaVersion") != 1:
        raise ValueError("Household configuration must use schemaVersion 1")
    if config.get("currency") not in CURRENCIES:
        raise ValueError("Choose USD, EUR, GBP, or ILS as the single base currency")
    accounts = config.get("accounts")
    if not isinstance(accounts, list) or not accounts:
        raise ValueError("Configure at least one account")
    seen = set()
    for account in accounts:
        if not isinstance(account, dict) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,80}", str(account.get("id", ""))):
            raise ValueError("Each account needs a stable id of letters, numbers, underscores, or hyphens")
        if account["id"] in seen or not account.get("name") or account.get("type") not in {"bank_account", "credit_card", "cash"}:
            raise ValueError("Accounts need unique ids, names, and supported types")
        if account.get("currency", config["currency"]) != config["currency"]:
            raise ValueError("All accounts must use the household base currency; automatic FX is unsupported")
        account["currency"] = config["currency"]
        seen.add(account["id"])
    categories = config.get("categories", [])
    if not isinstance(categories, list):
        raise ValueError("Categories must be an array")
    names = set()
    for item in categories:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not item["name"].strip() or item["name"] in names:
            raise ValueError("Categories need unique nonempty names")
        if money(item.get("budget", 0)) < 0:
            raise ValueError("Category budgets cannot be negative")
        names.add(item["name"])
    for field in ["openingBalance", "bufferTarget"]:
        config[field] = money(config.get(field, 0))
    if config["bufferTarget"] < 0:
        raise ValueError("The protected buffer cannot be negative")
    balance = config.get("balance")
    if balance:
        date.fromisoformat(balance["date"])
        money(balance["amount"])
        if balance.get("accountId") not in seen:
            raise ValueError("The balance must reference a configured account")
    for rule in config.get("rules", []):
        if not isinstance(rule, dict) or not isinstance(rule.get("contains"), str) or not rule["contains"].strip():
            raise ValueError("Every matching rule needs a nonempty contains string")
        if rule.get("type", "expense") not in {"expense", "income", "refund", "transfer", "card_settlement", "cash_withdrawal", "fee"}:
            raise ValueError("A rule has an unsupported transaction type")
    return config


def account_for(config: dict, account_id: str) -> dict:
    for account in config["accounts"]:
        if account["id"] == account_id:
            return account
    raise ValueError("Import account is not configured in the household file")
