"""Strict CSV mapping and adapters for the existing Israeli XLSX formats."""
from __future__ import annotations

import csv
import json
import re
from collections import Counter
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

from household_config import money

FORMATS = {"csv", "israeli-bank", "israeli-card"}
DATE_FORMATS = {"%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d.%m.%Y"}
COLUMNS = {"date", "description", "amount", "debit", "credit", "account", "currency", "type", "category",
           "reference", "billingDate", "isInstallment", "installmentNumber", "installmentCount", "purchaseAmount"}


def decimal_value(raw: str, mapping: dict) -> float:
    raw = raw.strip()
    decimal, thousands = mapping["decimalSeparator"], mapping.get("thousandsSeparator", "")
    group = rf"(?:\d+|\d{{1,3}}(?:{re.escape(thousands)}\d{{3}})+)" if thousands else r"\d+"
    if not re.fullmatch(rf"[+-]?{group}(?:{re.escape(decimal)}\d{{1,2}})?", raw):
        raise ValueError("Amount does not match the configured decimal/thousands convention")
    normalized = raw.replace(thousands, "") if thousands else raw
    normalized = normalized.replace(decimal, ".")
    return money(Decimal(normalized))


def load_mapping(path: Path) -> dict:
    mapping = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(mapping, dict) or mapping.get("schemaVersion") != 1:
        raise ValueError("CSV mapping must use schemaVersion 1")
    columns = mapping.get("columns")
    if not isinstance(columns, dict) or not {"date", "description"}.issubset(columns) or set(columns) - COLUMNS:
        raise ValueError("CSV mapping needs date and description columns and only documented fields")
    if not all(isinstance(v, str) and v.strip() for v in columns.values()) or len(set(columns.values())) != len(columns):
        raise ValueError("Mapped headers must be distinct nonempty strings")
    signed, split = "amount" in columns, {"debit", "credit"}.issubset(columns)
    if signed == split or (signed and ({"debit", "credit"} & set(columns))):
        raise ValueError("Map either amount OR both debit and credit columns")
    if mapping.get("dateFormat") not in DATE_FORMATS:
        raise ValueError("Choose an explicit supported dateFormat; dates are never guessed")
    if mapping.get("decimalSeparator") not in {".", ","} or mapping.get("thousandsSeparator", "") not in {"", ".", ",", " "}:
        raise ValueError("Configure explicit decimal and optional thousands separators")
    if mapping.get("thousandsSeparator") == mapping["decimalSeparator"]:
        raise ValueError("Decimal and thousands separators cannot be the same")
    if mapping.get("signConvention") not in {"debit_negative", "debit_positive"}:
        raise ValueError("Choose an explicit signConvention")
    if not isinstance(mapping.get("delimiter"), str) or len(mapping["delimiter"]) != 1 or mapping["delimiter"] in {"\n", "\r", '"'}:
        raise ValueError("Choose a single-character CSV delimiter")
    return mapping


def csv_rows(path: Path, mapping: dict) -> tuple[list[dict], dict]:
    rows, errors, blanks = [], [], 0
    with path.open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream, delimiter=mapping["delimiter"], strict=True)
        headers = reader.fieldnames or []
        if len(headers) != len(set(headers)) or set(mapping["columns"].values()) - set(headers):
            raise ValueError("CSV has duplicate headers or is missing mapped columns")
        for number, raw in enumerate(reader, 2):
            if not any(str(value or "").strip() for value in raw.values()):
                blanks += 1
                continue
            try:
                if None in raw or any(value is None for value in raw.values()):
                    raise ValueError("CSV row has the wrong number of fields")
                row = {key: raw[header].strip() for key, header in mapping["columns"].items()}
                row["date"] = datetime.strptime(row["date"], mapping["dateFormat"]).date().isoformat()
                if row.get("billingDate"):
                    row["billingDate"] = datetime.strptime(row["billingDate"], mapping["dateFormat"]).date().isoformat()
                if "amount" in row:
                    signed = decimal_value(row["amount"], mapping)
                    if mapping["signConvention"] == "debit_positive":
                        signed = -signed
                else:
                    debit = decimal_value(row["debit"], mapping) if row["debit"] else 0
                    credit = decimal_value(row["credit"], mapping) if row["credit"] else 0
                    if debit < 0 or credit < 0 or (debit and credit):
                        raise ValueError("Split debit/credit values must be nonnegative with one nonzero side")
                    signed = credit - debit
                row["signedAmount"] = signed
                row["sourceRow"] = number
                row["source"] = path.name
                if row.get("purchaseAmount"):
                    row["purchaseAmount"] = decimal_value(row["purchaseAmount"], mapping)
                for field in ["installmentNumber", "installmentCount"]:
                    if row.get(field):
                        if not re.fullmatch(r"[1-9]\d{0,2}", row[field]) or int(row[field]) > 120:
                            raise ValueError("Installment numbers/counts must be between 1 and 120")
                        row[field] = int(row[field])
                flag = str(row.get("isInstallment", "")).lower()
                if flag not in {"", "true", "false", "1", "0"}:
                    raise ValueError("isInstallment must be true, false, 1, or 0")
                row["isInstallment"] = flag in {"true", "1"}
                if row.get("type"):
                    row["type"] = mapping.get("types", {}).get(row["type"], row["type"])
                rows.append(row)
            except (ValueError, InvalidOperation, OverflowError) as exc:
                errors.append({"row": number, "error": str(exc)})
    return rows, {"parsedRows": len(rows), "blankRows": blanks, "errors": errors, "warnings": []}


def xlsx_rows(path: Path, kind: str, config: dict, bank_order="newest-first") -> tuple[list[dict], dict]:
    import xlsx_readers as readers
    if config["currency"] != "ILS":
        raise ValueError("The existing Israeli XLSX formats contain ILS charges; use an ILS household or CSV in your base currency")
    readers.PARSE_AUDIT.clear(); readers.CARD_ADJUSTMENTS.clear()
    raw = readers.parse_bank_transactions(path) if kind == "israeli-bank" else readers.parse_card_transactions(path)
    if not raw:
        raise ValueError("No supported transaction rows found. Check the format or use CSV with an explicit mapping.")
    rows, warnings = [], []
    if kind == "israeli-bank":
        ordered = list(reversed(raw)) if bank_order == "newest-first" else raw
        if any(a["date"] > b["date"] for a, b in zip(ordered, ordered[1:])):
            raise ValueError("Bank rows do not match --bank-order; select the correct source order")
        for previous, current in zip(ordered, ordered[1:]):
            if abs(round((previous["balance"] + current["credit"] - current["debit"] - current["balance"]) * 100)) > 1:
                raise ValueError("Bank running balances do not reconcile; review the source file before import")
    for item in raw:
        if kind == "israeli-bank":
            if item["debit"] and item["credit"]:
                raise ValueError("Bank row has both debit and credit")
            rows.append({"date": item["date"], "description": " · ".join(x for x in [item["action"], item["details"], item["beneficiary"], item["purpose"]] if x),
                         "signedAmount": item["credit"] - item["debit"], "reference": item["reference"],
                         "sourceRow": item["row"], "source": path.name, "balance": item["balance"], "currency": "ILS"})
        else:
            reference = item.get("reference", "")
            credit_type = item.get("credit_transaction_type") or item.get("provider_type", "")
            ordinal = re.search(r"(?:תשלום|installment)\s*(\d+)\s*(?:מתוך|of)\s*(\d+)", reference, re.I)
            installment = "תשלומים" in credit_type or bool(ordinal)
            if item.get("is_pending"):
                raise ValueError("Pending card transactions are not imported automatically; use a settled statement to avoid duplicate settlement rows")
            row = {"date": item["date"], "billingDate": item["billing_date"], "description": item["merchant"],
                   "signedAmount": -item["amount"], "reference": reference, "sourceRow": item["row"], "source": path.name,
                   "isInstallment": installment, "purchaseAmount": item["purchase_amount"], "currency": "ILS",
                   "creditTransactionType": credit_type}
            if ordinal:
                row["installmentNumber"], row["installmentCount"] = map(int, ordinal.groups())
            rows.append(row)
    if readers.CARD_ADJUSTMENTS:
        raise ValueError("Statement contains revolving-credit adjustments requiring a dedicated mapping; export those rows as CSV rather than silently omitting them")
    return rows, {"parsedRows": len(rows), "blankRows": 0, "errors": [], "warnings": warnings}
