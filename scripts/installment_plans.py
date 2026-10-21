"""Deterministic installment identity and purchase-month budget schedules.

Only derived fields are added; source transactions, amounts and billing dates stay intact.
Plans travel in snapshot state (D1 JSON) and links travel in transaction metadata.
"""
from __future__ import annotations

import argparse
import calendar
import hashlib
import json
import re
from collections import defaultdict
from statistics import median
from pathlib import Path

ORDINAL = re.compile(r"(?:תשלום|installment)\s*(\d+)\s*(?:מתוך|of)\s*(\d+)", re.I)


def cents(value):
    return round(float(value or 0) * 100)


def shifted(date, offset):
    y, m, d = map(int, date[:10].split("-"))
    y, m = divmod(y * 12 + m - 1 + offset, 12)
    m += 1
    return f"{y:04d}-{m:02d}-{min(d, calendar.monthrange(y, m)[1]):02d}"


def month_index(date):
    return int(date[:4]) * 12 + int(date[5:7]) - 1


def infer_regular_count(records, purchase_date, total):
    """Bounded estimate, never a statement-confirmed count.

    Regular cards normally start billing the month after purchase. Preserve that
    assumption explicitly; credit/unknown types must never enter this path.
    Whole-shekel installments may put rounding in the first payment (an uneven first payment).
    Decimal installments allow at most three cents per portion of adjustment.
    """
    if not total or not all(r[0].get("billingDate") for r in records):
        return None
    numbered = [(month_index(r[0]["billingDate"]) - month_index(purchase_date), cents(r[0]["amount"])) for r in records]
    if any(n < 1 for n, _ in numbered) or len({n for n, _ in numbered}) != len(numbered):
        return None
    regular = int(median([a for n, a in numbered if n > 1] or [a for _, a in numbered]))
    first = next((a for n, a in numbered if n == 1), None)
    if regular <= 0:
        return None
    count = round((total - first) / regular) + 1 if first is not None else round(total / regular)
    tolerance = count * (100 if regular % 100 == 0 else 3)
    expected = (first if first is not None else regular) + (count - 1) * regular
    if not 2 <= count <= 120 or max(n for n, _ in numbered) > count or abs(total - expected) > tolerance:
        return None
    if any(abs(a - regular) > tolerance for n, a in numbered if n > 1):
        return None
    return count


def enrich_installment_plans(ledger):
    allocations = {r.get("transactionId"): r for r in ledger.get("cardAllocations", [])}
    buckets = defaultdict(list)
    for tx in ledger.get("transactions", []):
        if not tx.get("isInstallment") or tx.get("type") == "refund" or cents(tx.get("amount")) <= 0:
            # Negative card charges remain credits; never turn their positive original
            # purchaseAmount into spending, even when the source flagged installments.
            continue
        alloc = allocations.get(tx.get("id"), {})
        tx["creditTransactionType"] = tx.get("creditTransactionType") or alloc.get("creditTransactionType") or ""
        reference = str(tx.get("reference") or alloc.get("reference") or "").strip()
        ordinal = ORDINAL.search(reference)
        stable_ref = ORDINAL.sub("", reference).strip()
        if stable_ref == "0":
            stable_ref = ""
        account = tx.get("account_id") or tx.get("accountId") or f"card-{alloc.get('card', '')}"
        total = cents(tx.get("purchaseAmount") or alloc.get("purchaseAmount"))
        key = (account, tx["date"], tx.get("merchantProfileId") or tx.get("merchant") or tx.get("description"), total)
        buckets[key].append((tx, reference, stable_ref, ordinal))

    plans = []
    for key, bucket in sorted(buckets.items()):
        refs = {r[2] for r in bucket if r[2]}
        groups = defaultdict(list)
        for record in bucket:
            # A missing reference can join only a single unambiguous reference group.
            ref = record[2] or (next(iter(refs)) if len(refs) == 1 else "")
            groups[ref].append(record)
        for ref, records in sorted(groups.items()):
            records.sort(key=lambda r: (r[0].get("billingDate", ""), r[0]["id"]))
            total = key[3]
            warning = None
            if len(refs) > 1 and not ref:
                warning = "Ambiguous purchase reference; allocation needs review"
            dates = [r[0].get("billingDate", "") for r in records]
            if len(set(dates)) != len(dates):
                warning = "Multiple portions on one billing date; allocation needs review"
            category_note = "Statement portions have different categories; their original categories are retained" if len({r[0].get("category") for r in records}) > 1 else None
            types = {r[0].get("creditTransactionType") for r in records if r[0].get("creditTransactionType")}
            credit_type = next(iter(types)) if len(types) == 1 else ""
            kind = "credit" if "קרדיט" in credit_type else "regular" if "תשלומים" in credit_type and "רגיל" in credit_type else "unknown"
            if len(types) > 1:
                warning = "Conflicting installment types in source exports"
            counts = {int(r[3][2]) for r in records if r[3]}
            count = next(iter(counts)) if len(counts) == 1 else None
            count_source = "statement" if count else None
            observed_sum = sum(cents(r[0]["amount"]) for r in records)
            # Complete observed plans can establish count without a total/portion ratio.
            complete = total > 0 and observed_sum == total and all(dates) and len(set(dates)) == len(dates)
            if not count and complete and all(month_index(b) - month_index(a) == 1 for a, b in zip(dates, dates[1:])):
                count, count_source = len(records), "complete_observed_schedule"
            if len(counts) > 1 or not total or not count or not 1 <= count <= 120:
                warning = warning or ("Conflicting installment counts in source exports" if len(counts) > 1 else "Purchase total missing from source export" if not total else "Credit installments: export does not state the payment count or financing schedule; actual billed payments are shown" if kind == "credit" else "Payment count not stated and cannot be reliably inferred from the available payments")
            plan_key = json.dumps([*key, ref], ensure_ascii=False)
            # Recompute derived IDs so previously merged plans split correctly
            # when their distinct purchase references are recovered.
            plan_id = "plan-" + hashlib.sha256(plan_key.encode()).hexdigest()[:20]
            plan = {"id": plan_id, "purchaseDate": key[1], "purchaseAmount": total / 100,
                    "accountId": key[0], "reference": ref, "merchant": records[0][0].get("normalizedMerchantName") or records[0][0].get("merchant"),
                    "category": records[0][0].get("category"), "installmentCount": count,
                    "kind": kind, "creditTransactionType": credit_type, "categoryNote": category_note,
                    "scheduleInferred": count_source == "inferred_regular_amounts",
                    "inferenceNote": "Count and sequence inferred from regular payment amounts; first billing assumed in the month after purchase" if count_source == "inferred_regular_amounts" else None,
                    "countSource": count_source, "transactionIds": [r[0]["id"] for r in records], "schedule": []}
            anchors = {month_index(r[0]["billingDate"]) - int(r[3][1]) + 1 for r in records if r[3] and r[0].get("billingDate")}
            if len(anchors) > 1:
                warning = "Conflicting installment dates; allocation needs review"
            anchor = next(iter(anchors)) if len(anchors) == 1 else None
            if anchor is None and count_source == "inferred_regular_amounts":
                anchor = month_index(key[1]) + 1
            numbers = {}
            for i, (tx, reference, _, ordinal) in enumerate(records):
                n = int(ordinal[1]) if ordinal else (month_index(tx["billingDate"]) - anchor + 1 if anchor is not None and tx.get("billingDate") else i + 1 if complete else None)
                tx["installmentPlanId"] = plan_id
                tx["installmentReference"] = reference
                tx["installmentNumber"] = n
                tx["installmentCount"] = count
                if n is None or n in numbers or (count and not 1 <= n <= count):
                    warning = warning or "Installment sequence unavailable; allocation needs review"
                if n is not None:
                    numbers[n] = tx
            # No undisclosed financing assumption: only explicitly numbered regular
            # payment plans with a nonnegative remaining principal are estimated.
            remainder = total - observed_sum
            missing = count - len(numbers) if count else 0
            if remainder < 0 or (count and missing == 0 and remainder != 0):
                warning = "Billed total differs from purchase principal; financing or missing charges need review"
            if kind == "credit":
                # Principal is not total repayments. Do not manufacture interest or
                # claim a complete financing schedule from principal/payment ratios.
                warning = "Credit installments: export does not provide a complete repayment schedule; actual billed payments are shown"
            if not warning:
                unobserved = [n for n in range(1, count + 1) if n not in numbers]
                for n in range(1, count + 1):
                    tx = numbers.get(n)
                    amount = cents(tx["amount"]) if tx else remainder // missing + (remainder % missing if n == unobserved[-1] else 0)
                    billed = tx.get("billingDate") if tx else None
                    projected = None
                    if not tx and anchor is not None:
                        first_n, first_tx = next(iter(numbers.items()))
                        projected = shifted(first_tx["billingDate"], n - first_n)
                    plan["schedule"].append({"id": f"{plan_id}:{n}", "number": n, "date": shifted(key[1], n - 1),
                                             "amount": amount / 100, "transactionId": tx["id"] if tx else None,
                                             "billingDate": billed, "projectedBillingDate": projected, "estimated": tx is None})
            plan["status"] = "needs_review" if warning else "ready"
            plan["warning"] = warning
            plans.append(plan)
    ledger["installmentPlans"] = sorted(plans, key=lambda p: p["id"])
    return ledger["installmentPlans"]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--ledger", type=Path, default=Path(__file__).resolve().parents[1] / "memory/ledger.json")
    args = parser.parse_args()
    ledger = json.loads(args.ledger.read_text())
    plans = enrich_installment_plans(ledger)
    print(json.dumps({"plans": len(plans), "ready": sum(p["status"] == "ready" for p in plans),
                      "review": [{"id": p["id"], "merchant": p["merchant"], "warning": p["warning"]} for p in plans if p["warning"]]}, ensure_ascii=False, indent=2))
    if args.apply:
        args.ledger.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + "\n")
