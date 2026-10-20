import { billingEvents, budgetEvents, decorateTransactions, isBudgetExpense, merchantDescription, normalizedMerchantName } from "./finance.js";

const nameKey = (tx) => normalizedMerchantName(tx).normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("he-IL");
const profileId = (tx) => tx.merchantProfileId || tx.merchant_profile_id;
const reviewed = (tx) => (tx.merchantProfileReviewed ?? tx.merchant_profile_reviewed) === true;

export function merchantKey(tx) {
  const id = profileId(tx);
  return id ? `profile:${id}` : `name:${nameKey(tx)}`;
}

export function merchantReportHref(tx, sourceHash = "#activity") {
  const [view, query = ""] = sourceHash.replace(/^#/, "").split("?");
  const source = new URLSearchParams(query);
  const basis = ["purchase", "installments", "billing"].includes(source.get("basis"))
    ? source.get("basis") : view === "budget" || tx.timingBasis === "installments" ? "installments" : view === "commitments" || tx.timingBasis === "billing" ? "billing" : "purchase";
  const params = new URLSearchParams({ merchant: merchantKey(tx), month: source.get("month") || String(tx.date).slice(0, 7), basis, report: "month" });
  // Do not create nested return routes when browsing a merchant's own transactions.
  params.set("from", view === "merchant" ? source.get("from") || "#activity" : sourceHash);
  return `#merchant?${params}`;
}

export function merchantReturnHref(value) {
  const [view] = String(value || "").replace(/^#/, "").split("?");
  return String(value || "").startsWith("#") && ["today", "budget", "commitments", "income", "activity"].includes(view)
    ? value : "#activity";
}

function dateString(date) { return date.toISOString().slice(0, 10); }
function shiftDate(value, days) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return dateString(date); }
function monday(value) { const date = new Date(`${value}T00:00:00Z`); return shiftDate(value, -((date.getUTCDay() + 6) % 7)); }
function monthEnd(month) { const [year, index] = month.split("-").map(Number); return dateString(new Date(Date.UTC(year, index, 0))); }
function monthRange(first, last) {
  const result = [];
  const [year, index] = first.split("-").map(Number);
  const date = new Date(Date.UTC(year, index - 1, 1));
  while (dateString(date).slice(0, 7) <= last && result.length < 1200) {
    result.push(dateString(date).slice(0, 7)); date.setUTCMonth(date.getUTCMonth() + 1);
  }
  return result;
}

export function summarizeMerchantRows(rows) {
  let spentCents = 0, refundCents = 0, purchaseCount = 0;
  for (const tx of rows) {
    const amount = Math.round(Number(tx.amount || 0) * 100);
    if (tx.type === "refund" || amount < 0) refundCents += Math.abs(amount);
    else if (isBudgetExpense(tx) && amount > 0) { spentCents += amount; purchaseCount += 1; }
  }
  return { spent: spentCents / 100, refunds: refundCents / 100, net: (spentCents - refundCents) / 100,
    purchaseCount, count: rows.length, average: purchaseCount ? spentCents / 100 / purchaseCount : 0 };
}

export function buildMerchantReport(ledger, key, { month, basis = "purchase", today = dateString(new Date()) } = {}) {
  basis = ["purchase", "installments", "billing"].includes(basis) ? basis : "purchase";
  month = /^\d{4}-(0[1-9]|1[0-2])$/.test(month || "") ? month : today.slice(0, 7);
  const transactions = ledger?.transactions || [];
  const seed = transactions.find((tx) => merchantKey(tx) === key);
  if (!seed) return null;
  const matches = (tx) => merchantKey(tx) === key || (profileId(seed) && profileId(tx) && reviewed(seed) && reviewed(tx) && nameKey(tx) === nameKey(seed));
  const financialRows = (basis === "billing" ? billingEvents(ledger) : budgetEvents(ledger, basis))
    .filter((tx) => /^\d{4}-\d{2}-\d{2}$/.test(tx.date || "") && (isBudgetExpense(tx) || tx.type === "refund"));
  const rows = financialRows.filter(matches);
  const observedDates = transactions.map((tx) => basis === "billing" ? tx.billingDate || tx.date : tx.purchaseDate || tx.date)
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date || "") && date <= today).sort();
  const coverageStart = observedDates[0] || today;
  const through = observedDates.at(-1) || today;
  const rawMonths = rows.map((tx) => tx.date.slice(0, 7));
  const endpoints = [...rawMonths, month].sort();
  const months = monthRange(endpoints[0], endpoints.at(-1));
  const statusFor = (start, end) => start > today ? "Planned" : start > through ? "Not yet imported" : start < coverageStart || end > through ? "Partial" : "";
  const inRange = (start, end) => rows.filter((tx) => tx.date >= start && tx.date <= end);
  const monthly = months.map((value) => ({ month: value, ...summarizeMerchantRows(inRange(`${value}-01`, monthEnd(value))), status: statusFor(`${value}-01`, monthEnd(value)) }));
  const weeks = [];
  for (let start = monday(`${month}-01`); start <= monthEnd(month); start = shiftDate(start, 7)) {
    const end = shiftDate(start, 6);
    const previousStart = shiftDate(start, -7), previousEnd = shiftDate(start, -1);
    const current = summarizeMerchantRows(inRange(start, end));
    const previous = summarizeMerchantRows(inRange(previousStart, previousEnd));
    const status = statusFor(start, end);
    const canCompare = !status && !statusFor(previousStart, previousEnd);
    weeks.push({ start, end, ...current, status, change: canCompare ? current.net - previous.net : null,
      changePercent: canCompare && previous.net > 0 ? (current.net - previous.net) / previous.net * 100 : null });
  }
  const defaultWeek = weeks.find((week) => through >= week.start && through <= week.end && week.count > 0)
    || [...weeks].reverse().find((week) => week.start <= through && week.count > 0)
    || weeks.find((week) => through >= week.start && through <= week.end) || weeks[0];
  const selected = monthly.find((item) => item.month === month);
  const previous = monthly.find((item) => item.month === shiftDate(`${month}-01`, -1).slice(0, 7));
  return { key, name: normalizedMerchantName(seed), description: merchantDescription(seed).split(" Statement:")[0],
    basis, month, months, monthly, weeks, defaultWeek: defaultWeek.start, through, coverageStart,
    rows: decorateTransactions(rows).map((tx) => ({ ...tx, monthlyTotal: null })),
    allTime: summarizeMerchantRows(rows), selected,
    monthChange: selected && previous && !selected.status && !previous.status ? selected.net - previous.net : null,
    estimatedCount: rows.filter((tx) => tx.allocationEstimated).length };
}
