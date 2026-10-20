export let CURRENCY = "USD";
export function setDisplayCurrency(currency) {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Currency must be an ISO code");
  CURRENCY = currency;
}
import { buildBudgetPlan, resolveBudgetCatalog } from "./budgetPlan.js";

export const DEFAULT_FLEXIBLE_CATEGORIES = new Set([
  "Groceries",
  "Dining",
  "Transport",
  "Shopping",
  "Travel",
  "Cash",
  "Personal Care",
  "Entertainment"
]);

export function categorySpendingType(category) {
  const explicit = category?.spendingType || category?.spending_type;
  if (explicit === "flexible" || explicit === "committed") return explicit;
  const name = category?.name ?? category?.category ?? category;
  return DEFAULT_FLEXIBLE_CATEGORIES.has(String(name || "")) ? "flexible" : "committed";
}

export function money(value) {
  return new Intl.NumberFormat("en-IL", {
    style: "currency",
    currency: CURRENCY,
    maximumFractionDigits: 0
  }).format(Math.round(Number(value || 0))).replace(/\s/g, "");
}

export function number(value) {
  return Number(value || 0);
}

export function sum(items, picker) {
  return items.reduce((total, item) => total + number(picker(item)), 0);
}

export function parseLocalDate(dateString) {
  const [year, month, day] = String(dateString).split("-").map(Number);
  return new Date(year, month - 1, day || 1);
}

export function formatMonth(monthValue) {
  const date = parseLocalDate(`${monthValue}-01`);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
}

export function daysInMonth(monthValue) {
  const [year, month] = String(monthValue).split("-").map(Number);
  return new Date(year, month, 0).getDate();
}

export function futureMonthRange(monthValue, count = 12) {
  const [year, month] = String(monthValue).split("-").map(Number);
  return Array.from({ length: count + 1 }, (_, index) => {
    const date = new Date(year, month - 1 + index, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
}

export function dayOf(dateString) {
  return Number(String(dateString).slice(8, 10));
}

export function datediffDays(fromDate, toDate) {
  const ms = parseLocalDate(toDate) - parseLocalDate(fromDate);
  return Math.max(0, Math.round(ms / 86400000));
}

export function latestDate(items, fallback) {
  return items.map((item) => transactionMonthDate(item)).filter(Boolean).sort().at(-1) || fallback;
}

function latestVisibleDate(items, fallback) {
  return items.map((item) => String(item?.date || "")).filter(Boolean).sort().at(-1) || fallback;
}

export function transactionMonthDate(tx) {
  const purchaseDate = tx?.purchaseDate || tx?.date || tx?.transaction_date || "";
  const isInstallment = tx?.isInstallment ?? tx?.is_installment ?? false;
  if (!isInstallment) return purchaseDate;
  return tx?.billingDate || tx?.billing_date || purchaseDate;
}

export function transactionForReporting(tx) {
  const reportingDate = transactionMonthDate(tx);
  if (!reportingDate || reportingDate === tx.date) return tx;
  return {
    ...tx,
    purchaseDate: tx.purchaseDate || tx.date,
    date: reportingDate
  };
}

export function purchaseDateFor(tx) {
  return String(tx?.purchaseDate || tx?.date || tx?.transaction_date || "");
}

export function billingDateFor(tx) {
  return String(tx?.billingDate || tx?.billing_date || purchaseDateFor(tx));
}

function transactionAccount(tx) {
  return String(tx?.account_id || tx?.accountId || tx?.card || "").trim();
}

function isCardTransaction(tx) {
  return Boolean(tx?.billingDate || tx?.billing_date) && !["income", "refund", "transfer", "card_settlement", "cash_withdrawal"].includes(tx?.type);
}

function purchaseEventKey(tx, index) {
  if (tx?.installmentPlanId && number(tx.amount) > 0) return tx.installmentPlanId;
  if (number(tx?.amount) < 0) return `credit:${tx?.id || index}`;
  if (!tx?.isInstallment && !tx?.is_installment) return `transaction:${tx?.id || tx?.fingerprint || index}`;
  const reference = String(tx?.reference || "").replace(/(?:תשלום|installment)\s*\d+\s*(?:מתוך|of)\s*\d+/giu, "").trim();
  return [
    "installment",
    transactionAccount(tx),
    purchaseDateFor(tx),
    normalizedMerchantName(tx),
    number(tx?.purchaseAmount ?? tx?.purchase_amount ?? tx?.amount),
    reference && reference !== "0" ? reference : "no-reference"
  ].join("|").toLocaleLowerCase("he-IL");
}

export function purchaseEvents(ledger) {
  const plans = new Map((ledger?.installmentPlans || []).map((plan) => [plan.id, plan]));
  const events = new Map();
  for (const [index, tx] of (ledger?.transactions || []).entries()) {
    const key = purchaseEventKey(tx, index);
    const purchaseAmount = number(tx?.purchaseAmount ?? tx?.purchase_amount ?? tx?.amount);
    const plan = plans.get(tx.installmentPlanId);
    const amount = number(tx.amount) > 0 && Boolean(tx?.isInstallment ?? tx?.is_installment) && purchaseAmount > 0
      ? purchaseAmount
      : number(tx?.amount);
    const event = {
      ...tx,
      id: `purchase:${key}`,
      sourceTransactionId: tx.id,
      date: purchaseDateFor(tx),
      purchaseDate: purchaseDateFor(tx),
      billingDate: tx?.billingDate || tx?.billing_date || null,
      amount: tx.type === "refund" ? -Math.abs(number(tx.amount)) : plan?.purchaseAmount || amount,
      installmentPlan: plan,
      allocationWarning: plan?.warning,
      purchaseEvent: true,
      timingBasis: "purchase"
    };
    const current = events.get(key);
    if (!current || number(event.purchaseAmount) > number(current.purchaseAmount) || String(event.billingDate || "") < String(current.billingDate || "")) {
      events.set(key, event);
    }
  }
  return [...events.values()];
}

export function installmentBudgetEvents(ledger) {
  const plans = new Map((ledger?.installmentPlans || []).map((plan) => [plan.id, plan]));
  const transactions = ledger?.transactions || [];
  const rows = transactions.filter((tx) => !tx.isInstallment || number(tx.amount) <= 0).map((tx) => ({ ...tx, date: purchaseDateFor(tx), amount: tx.type === "refund" ? -Math.abs(number(tx.amount)) : number(tx.amount) }));
  for (const plan of plans.values()) {
    const portions = transactions.filter((tx) => tx.installmentPlanId === plan.id && number(tx.amount) > 0);
    const template = portions[0];
    if (!template) continue;
    if (plan.status !== "ready") {
      rows.push(...portions.map((tx) => ({ ...tx, date: billingDateFor(tx), purchaseDate: purchaseDateFor(tx), installmentPlan: plan,
        allocationWarning: plan.warning, timingBasis: "provisional" })));
      continue;
    }
    for (const portion of plan.schedule) {
      const source = portions.find((tx) => tx.id === portion.transactionId) || template;
      rows.push({ ...source, id: portion.id, sourceTransactionId: portion.transactionId, date: portion.date,
        purchaseDate: plan.purchaseDate, purchaseAmount: plan.purchaseAmount, amount: portion.amount,
        billingDate: portion.billingDate, projectedBillingDate: portion.projectedBillingDate,
        installmentNumber: portion.number, installmentCount: plan.installmentCount, installmentPlan: plan,
        allocationEstimated: portion.estimated, timingBasis: "installments" });
    }
  }
  // Compatibility with older snapshots: retain every observed portion visibly.
  rows.push(...transactions.filter((tx) => tx.isInstallment && number(tx.amount) > 0 && !plans.has(tx.installmentPlanId))
    .map((tx) => ({ ...tx, date: billingDateFor(tx), purchaseDate: purchaseDateFor(tx),
      allocationWarning: "Allocation needs review: installment schedule unavailable", timingBasis: "provisional" })));
  return rows;
}

export function budgetEvents(ledger, basis = "purchase") {
  return basis === "installments" ? installmentBudgetEvents(ledger) : purchaseEvents(ledger);
}

export function projectedBillingEvents(ledger) {
  return installmentBudgetEvents(ledger).filter((tx) => tx.allocationEstimated && tx.projectedBillingDate)
    .map((tx) => ({ ...tx, date: tx.projectedBillingDate, timingBasis: "projected_billing" }));
}

export function billingEvents(ledger) {
  const plans = new Map((ledger?.installmentPlans || []).map((plan) => [plan.id, plan]));
  return (ledger?.transactions || []).map((tx) => ({
    ...tx,
    installmentPlan: plans.get(tx.installmentPlanId),
    date: billingDateFor(tx),
    purchaseDate: purchaseDateFor(tx),
    billingDate: tx?.billingDate || tx?.billing_date || null,
    amount: tx.type === "refund" ? -Math.abs(number(tx.amount)) : number(tx.amount),
    timingBasis: "billing"
  }));
}

function monthsForTransactions(transactions) {
  return [...new Set(transactions
    .map((tx) => String(tx?.date || "").slice(0, 7))
    .filter((month) => /^\d{4}-\d{2}$/.test(month)))]
    .sort();
}

export function decorateTransactions(transactions) {
  const groups = buildMonthlyTransactionGroups(
    transactions.filter((tx) => !["income", "refund", "transfer"].includes(tx.type))
  );
  return [...transactions]
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || number(b.amount) - number(a.amount))
    .map((tx) => {
      const group = groups[transactionGroupKey(tx)];
      const showMonthlyTotal = group?.count > 1 && tx.direction !== "inflow" && tx.type !== "income";
      return {
        ...tx,
        monthlyTotal: showMonthlyTotal ? {
          label: `${money(group.total)} month total · ${group.count} tx`,
          items: group.items.map((item) => ({
            date: monthShortDayFromDate(item.date),
            amount: money(item.amount)
          }))
        } : null
      };
    });
}

export function normalizedMerchantName(tx) {
  const explicitName = tx.normalizedMerchantName
    || tx.normalized_merchant_name
    || tx.merchantName
    || tx.merchant_name;
  if (explicitName) return String(explicitName).trim().replace(/\s+/g, " ");

  const merchant = String(tx.merchant || tx.description || "Transaction")
    .replace(/\s*\(\d{4}\)(?:\s+\[[^\]]+\])?\s*$/, "")
    .replace(/,\s*\d+\s*$/, "")
    .trim()
    .replace(/\s+/g, " ");
  return merchant || "Transaction";
}

export function merchantDescription(tx) {
  const merchant = normalizedMerchantName(tx);
  const categoryDescriptions = {
    Dining: "Restaurant, cafe, or food-service merchant.",
    Groceries: "Supermarket, grocery store, or food market.",
    Travel: "Airline, hotel, booking, or other travel merchant.",
    Transport: "Transit, taxi, fuel, toll, or parking merchant.",
    "Technology & Subscriptions": "Digital service or technology subscription.",
    Communications: "Phone, internet, or mobile-data provider.",
    Shopping: "Retail or online-shopping merchant.",
    "Education & Kids": "Education, lesson, or children's merchant.",
    Entertainment: "Games, events, or entertainment merchant.",
    Health: "Health, pharmacy, or personal-care merchant.",
    Housing: "Home, building, or household-services merchant."
  };
  const explicitDescription = tx.merchantDescription || tx.merchant_description;
  const brief = explicitDescription
    || categoryDescriptions[tx.category]
    || `${tx.category || "General"} merchant.`;
  const statement = String(tx.description || tx.merchant || "").trim();
  return statement && statement !== merchant
    ? `${brief} Statement: ${statement}`
    : brief;
}

function transactionGroupKey(tx) {
  return [
    tx.category || "Other",
    normalizedMerchantName(tx)
  ].map((part) => String(part).trim().replace(/\s+/g, " ").toLocaleLowerCase("he-IL")).join("::");
}

function buildMonthlyTransactionGroups(transactions) {
  const groups = transactions.reduce((totals, tx) => {
    const key = transactionGroupKey(tx);
    totals[key] ??= { total: 0, count: 0, items: [] };
    totals[key].total += number(tx.amount);
    totals[key].count += 1;
    totals[key].items.push({ date: tx.date, amount: number(tx.amount) });
    return totals;
  }, {});

  Object.values(groups).forEach((group) => {
    group.items.sort((a, b) => String(b.date).localeCompare(String(a.date)) || number(b.amount) - number(a.amount));
  });

  return groups;
}

export function ledgerMonths(ledger) {
  return [...new Set((ledger.transactions || [])
    .map((tx) => String(transactionMonthDate(tx)).slice(0, 7))
    .filter((month) => /^\d{4}-\d{2}$/.test(month)))]
    .sort();
}

export function isBudgetExpense(tx) {
  if (tx.type === "refund") return number(tx.amount) !== 0;
  if (tx.direction === "inflow") return false;
  if (["income", "refund", "transfer", "card_settlement", "cash_withdrawal"].includes(tx.type)) return false;
  return number(tx.amount) !== 0;
}

export function isIncomeTransaction(tx) {
  return tx.type === "income" || (tx.direction === "inflow" && !["refund", "transfer", "card_settlement"].includes(tx.type));
}

export function classifyIncomeSource(item) {
  const text = [
    item.source,
    item.who,
    item.description,
    item.merchant,
    item.category,
    item.type,
    item.note
  ].filter(Boolean).join(" ").toLowerCase();
  return /salary|payroll|wage|משכורת/.test(text) ? "salary" : "other";
}

export function categoryIcon(category) {
  const key = String(category || "").toLowerCase();
  if (key.includes("dining")) return "dining";
  if (key.includes("transport")) return "transport";
  if (key.includes("health")) return "health";
  if (key.includes("cash")) return "cash";
  if (key.includes("grocer")) return "groceries";
  if (key.includes("housing") || key.includes("utilities") || key.includes("municipal")) return "home";
  if (key.includes("education") || key.includes("kids") || key.includes("family")) return "family";
  if (key.includes("debt") || key.includes("payment")) return "bank";
  if (key.includes("communication")) return "phone";
  return "receipt";
}

export function normalizeDatabasePayload(payload) {
  const transactions = (payload.transactions || []).map((tx) => ({
    ...tx,
    id: tx.source_id || tx.id,
    date: tx.transaction_date || tx.date,
    billingDate: tx.billing_date || tx.billingDate,
    isInstallment: tx.is_installment ?? tx.isInstallment ?? false,
    category: tx.category || "Other",
    costLabel: tx.cost_label || tx.costLabel,
    categoryReviewed: tx.category_reviewed ?? tx.categoryReviewed,
    normalizedMerchantName: tx.normalizedMerchantName || tx.normalized_merchant_name || tx.metadata?.normalizedMerchantName,
    merchantDescription: tx.merchantDescription || tx.merchant_description || tx.metadata?.merchantDescription,
    merchantProfileId: tx.merchantProfileId || tx.merchant_profile_id || tx.metadata?.merchantProfileId,
    merchantProfileReviewed: tx.merchantProfileReviewed ?? tx.merchant_profile_reviewed ?? tx.metadata?.merchantProfileReviewed ?? false,
    merchantReviewRequired: tx.merchantReviewRequired ?? tx.merchant_review_required ?? tx.metadata?.merchantReviewRequired ?? false,
    sourceRefs: tx.source_refs || tx.sourceRefs || [],
    source: tx.source_label || tx.source
  }));
  const accounts = (payload.accounts || []).map((account) => ({
    ...account,
    id: account.source_id || account.id,
    cardLast4: account.card_last4 || account.cardLast4,
    matchHints: account.match_hints || account.matchHints || []
  }));
  const balanceSnapshots = (payload.balance_snapshots || payload.balanceSnapshots || []).map((snapshot) => ({
    ...snapshot,
    id: snapshot.source_id || snapshot.id,
    date: snapshot.snapshot_date || snapshot.date,
    observed_balance: snapshot.observed_balance ?? snapshot.observedBalance,
    account_id: snapshot.account_source_id || snapshot.account_id
  }));
  const categoryRules = (payload.category_rules || payload.categoryRules || []).map((rule) => ({
    ...rule,
    id: rule.source_id || rule.id,
    costLabel: rule.cost_label || rule.costLabel,
    observedCount: rule.observed_count ?? rule.observedCount
  }));
  const importRuns = (payload.import_runs || payload.importRuns || []).map((run) => ({
    ...run,
    id: run.source_id || run.id,
    createdAt: run.imported_at || run.created_at || run.createdAt,
    importedAt: run.imported_at || run.importedAt,
    sourceFiles: run.source_files || run.sourceFiles || []
  }));

  return {
    schemaVersion: 1,
    installmentPlans: payload.installmentPlans || [],
    recurringCosts: payload.recurringCosts || [],
    currency: payload.currency || CURRENCY,
    transactions,
    accounts,
    balanceSnapshots,
    cardAllocations: payload.card_allocations || payload.cardAllocations || [],
    categoryRules,
    importRuns
  };
}

export function buildBudgetRows(categories, transactions, monthProgress) {
  const actualByCategory = transactions.reduce((totals, tx) => {
    const category = tx.category || "Other";
    totals[category] = (totals[category] || 0) + number(tx.amount);
    return totals;
  }, {});

  return categories
    .filter((cat) => number(cat.budget ?? cat.goal) > 0 || actualByCategory[cat.name ?? cat.category])
    .map((cat) => {
      const category = cat.name ?? cat.category;
      const goal = number(cat.budget ?? cat.goal);
      const hasGoal = goal > 0;
      const actual = number(actualByCategory[category]);
      const expected = goal * monthProgress;
      const remaining = hasGoal ? goal - actual : 0;
      const pace = actual - expected;
      const statusKey = !hasGoal && actual > 0 ? "unbudgeted" : actual > goal ? "risk" : pace > 0 ? "watch" : "ok";
      return {
        icon: categoryIcon(category),
        category,
        spendingType: categorySpendingType(cat),
        manualGoal: number(cat.manualBudget ?? goal),
        recurringMinimum: number(cat.recurringMinimum),
        goal,
        hasGoal,
        actual,
        expected,
        remaining,
        pace,
        goalLabel: hasGoal ? money(goal) : "No goal",
        actualLabel: money(actual),
        expectedLabel: money(expected),
        remainingLabel: hasGoal ? `${remaining < 0 ? "-" : ""}${money(Math.abs(remaining))}` : "No goal",
        status: statusKey === "unbudgeted" ? "Unbudgeted" : statusKey === "risk" ? "Over" : statusKey === "watch" ? "Watch" : "On track",
        statusKey
      };
    })
    .sort((a, b) => b.goal - a.goal || b.actual - a.actual);
}

export function applySharedState(importedState, ledger, sharedState = {}, month) {
  const settings = sharedState.settings || {};
  const overrides = sharedState.budgetOverridesByMonth?.[month] || {};
  const categorySettings = sharedState.categorySettings || {};
  const state = {
    ...importedState,
    currency: settings.currency || importedState.currency || CURRENCY,
    openingBalance: settings.openingBalance ?? importedState.openingBalance,
    bufferTarget: settings.bufferTarget ?? importedState.bufferTarget,
    categories: (importedState.categories || []).map((category) => ({
      ...category,
      spendingType: categorySettings[category.name]?.spendingType
        || categorySettings[category.name]
        || categorySpendingType(category),
      budget: Object.prototype.hasOwnProperty.call(overrides, category.name)
        ? number(overrides[category.name])
        : number(category.budget ?? category.goal)
    }))
  };
  const cashTransactions = (sharedState.travelCashEntries || []).map((entry) => {
    const saved = entry.type === "saved";
    const category = saved ? "Cash" : entry.category === "Family" ? "Other" : entry.category || "Other";
    return {
      id: `cash-report-tx-${entry.id}`,
      date: entry.date,
      description: `Cash report: ${entry.note || `${entry.amount} ${entry.currency}`} [${entry.amount} ${entry.currency}]`,
      merchant: entry.note || "Cash report",
      category,
      amount: Math.round(number(entry.nisValue) * 100) / 100,
      currency: state.currency,
      direction: "outflow",
      type: saved ? "cash_withdrawal" : "cash_spend",
      source: `${entry.rateLabel || "Cash report"} · shared household report`,
      reference: entry.id
    };
  }).filter((tx) => tx.amount > 0);
  const recurringOverrides = sharedState.recurringOverridesByMonth?.[month] || {};
  const recurringCosts = (ledger.recurringCosts || []).map((cost) => {
    const override = recurringOverrides[cost.id];
    return {
      ...cost,
      baseMonthlyFunding: number(cost.baseMonthlyFunding ?? cost.monthlyFunding),
      monthlyFunding: override ? number(override.amount) : number(cost.monthlyFunding),
      included: override ? override.included !== false : true,
      monthlyOverride: Boolean(override),
    };
  });
  return { state, ledger: { ...ledger, recurringCosts, transactions: [...(ledger.transactions || []), ...cashTransactions] } };
}

export function buildRecurringPlan(ledger, month, today = new Date().toISOString().slice(0, 10)) {
  const actualById = billingEvents(ledger)
    .filter((tx) => String(tx.date || "").startsWith(month) && isBudgetExpense(tx) && tx.recurringCostId)
    .reduce((totals, tx) => {
      totals[tx.recurringCostId] = (totals[tx.recurringCostId] || 0) + number(tx.amount);
      return totals;
    }, {});
  const currentMonth = today.slice(0, 7);
  const items = (ledger.recurringCosts || []).map((cost) => {
    const included = cost.included !== false;
    const planned = included ? number(cost.monthlyFunding) : 0;
    const actual = number(actualById[cost.id]);
    const remaining = Math.max(0, planned - actual);
    const over = Math.max(0, actual - planned);
    const statusKey = !included ? "excluded" : over > 1 ? "risk" : actual > 0 && remaining <= 1 ? "paid" : actual > 0 ? "partial" : month < currentMonth ? "missing" : "upcoming";
    const status = { excluded: "Excluded", risk: "Over plan", paid: "Paid", partial: "Partly paid", missing: "Not found", upcoming: "Upcoming" }[statusKey];
    return {
      ...cost,
      confidence: cost.status,
      included,
      planned,
      actual,
      remaining,
      over,
      status,
      statusKey,
      baseMonthlyFunding: number(cost.baseMonthlyFunding ?? cost.monthlyFunding),
    };
  });
  const includedItems = items.filter((item) => item.included);
  const byCategory = Object.values(includedItems.reduce((groups, item) => {
    groups[item.category] ??= { category: item.category, planned: 0, actual: 0, remaining: 0, count: 0 };
    groups[item.category].planned += item.planned;
    groups[item.category].actual += item.actual;
    groups[item.category].remaining += item.remaining;
    groups[item.category].count += 1;
    return groups;
  }, {})).sort((a, b) => b.planned - a.planned || a.category.localeCompare(b.category));
  return {
    items,
    byCategory,
    total: sum(includedItems, (item) => item.planned),
    actual: sum(includedItems, (item) => item.actual),
    remaining: sum(includedItems, (item) => item.remaining),
    over: sum(includedItems, (item) => item.over),
    count: includedItems.length,
    outstandingCount: includedItems.filter((item) => item.remaining > 1).length,
    attentionCount: includedItems.filter((item) => item.over > 1 || item.statusKey === "missing").length,
    overrideCount: items.filter((item) => item.monthlyOverride).length,
  };
}

function categoriesWithRecurringMinimum(categories, recurringPlan) {
  const minimums = Object.fromEntries(recurringPlan.byCategory.map((row) => [row.category, row.planned]));
  const existing = new Set((categories || []).map((category) => category.name ?? category.category));
  const rows = (categories || []).map((category) => {
    const name = category.name ?? category.category;
    const manualBudget = number(category.budget ?? category.goal);
    const recurringMinimum = number(minimums[name]);
    return { ...category, manualBudget, recurringMinimum, budget: Math.max(manualBudget, recurringMinimum) };
  });
  for (const [name, recurringMinimum] of Object.entries(minimums)) {
    if (!existing.has(name)) rows.push({ name, manualBudget: 0, recurringMinimum, budget: recurringMinimum });
  }
  return rows;
}

export function buildBudgetTrendData(importedState, ledger, sharedState = {}, selectedMonth, category = null, basis = "purchase", historyEnd = selectedMonth) {
  const selectedModel = applySharedState(importedState, ledger, sharedState, selectedMonth);
  const selectedCatalog = resolveBudgetCatalog(selectedModel.state, selectedModel.ledger, sharedState, selectedMonth);
  const selectedCategory = category ? selectedCatalog.categories.find((item) => item.name === category) : null;
  const cashMonths = (sharedState.travelCashEntries || []).map((entry) => String(entry.date || "").slice(0, 7));
  const reportedMonths = [...new Set([
    ...monthsForTransactions(budgetEvents(ledger, basis)),
    ...cashMonths,
    importedState.month,
    ...(importedState.monthlyStatus || []).map((row) => row.month)
  ].filter((value) => /^\d{4}-\d{2}$/.test(value) && value <= selectedMonth))].sort();
  const availableMonths = [...new Set([...reportedMonths, selectedMonth])].sort();
  const months = availableMonths.filter((value) => value <= historyEnd).slice(-6);

  const rows = months.map((month) => {
    const model = applySharedState(importedState, ledger, sharedState, month);
    const transactions = budgetEvents(model.ledger, basis)
      .filter((tx) => String(tx.date || "").startsWith(month) && isBudgetExpense(tx));
    const plan = buildBudgetPlan(model.state, model.ledger, sharedState, month, transactions, [], 0, 1);
    const categoryPlan = category
      ? plan.categories.find((item) => selectedCategory ? item.id === selectedCategory.id : item.name === category)
      : null;
    const goal = category
      ? number(categoryPlan?.planned)
      : plan.total;
    const actual = category ? number(categoryPlan?.actual) : sum(transactions, (tx) => tx.amount);
    const hasGoal = goal > 0;
    const percent = hasGoal ? Math.round((actual / goal) * 100) : null;
    const statusKey = !hasGoal && actual > 0
      ? "unbudgeted"
      : hasGoal && actual > goal
        ? "risk"
        : hasGoal && percent >= 85
          ? "watch"
          : "ok";
    const date = parseLocalDate(`${month}-01`);

    return {
      month,
      label: new Intl.DateTimeFormat("en-US", { month: "short" }).format(date),
      year: month.slice(2, 4),
      goal,
      actual,
      hasGoal,
      percent,
      statusKey,
      status: statusKey === "unbudgeted" ? "Unbudgeted" : statusKey === "risk" ? "Over" : statusKey === "watch" ? "Watch" : "On track",
      isSelected: month === selectedMonth
    };
  });

  return {
    basis,
    category,
    rows,
    availableMonths,
    reportedMonths,
    scaleMax: Math.max(1, ...rows.flatMap((row) => [Math.max(0, row.goal), Math.max(0, row.actual)]))
  };
}

export function weekRangesForMonth(month) {
  const totalDays = daysInMonth(month);
  const ranges = [];
  for (let startDay = 1; startDay <= totalDays; startDay += 7) {
    const endDay = Math.min(totalDays, startDay + 6);
    const start = `${month}-${String(startDay).padStart(2, "0")}`;
    const end = `${month}-${String(endDay).padStart(2, "0")}`;
    ranges.push({ start, end, label: `${monthShortDayFromDate(start)}–${monthShortDayFromDate(end)}` });
  }
  return ranges;
}

export function buildWeeklyReport(transactions, budgetRows, month, categoryNameBySource = new Map()) {
  const ranges = weekRangesForMonth(month);
  const goals = Object.fromEntries(budgetRows.map((row) => [row.category, row.goal]));
  const weeks = ranges.map((range) => {
    const rows = transactions.filter((tx) => tx.date >= range.start && tx.date <= range.end && isBudgetExpense(tx));
    const grouped = rows.reduce((result, tx) => {
      const category = categoryNameBySource.get(tx.category) || tx.category || "Other";
      result[category] ??= { category, totalRaw: 0, count: 0, transactions: [] };
      result[category].totalRaw += number(tx.amount);
      result[category].count += 1;
      result[category].transactions.push(tx);
      return result;
    }, {});
    const categories = Object.values(grouped).sort((a, b) => b.totalRaw - a.totalRaw);
    const totalRaw = sum(categories, (row) => row.totalRaw);
    return {
      ...range,
      totalRaw,
      total: money(totalRaw),
      count: rows.length,
      categories: categories.map((row) => ({
        ...row,
        total: money(row.totalRaw),
        share: totalRaw ? Math.round((row.totalRaw / totalRaw) * 100) : 0,
        weeklyPlan: money(number(goals[row.category]) / Math.max(1, ranges.length))
      }))
    };
  });
  const active = [...weeks].reverse().find((week) => week.totalRaw > 0) || weeks[0];
  return { weeks, activeWeekStart: active?.start };
}

export function buildDailyReport(transactions, month, today, categoryNameBySource = new Map()) {
  const currentMonth = String(today).slice(0, 7);
  const lastDay = month === currentMonth ? Math.min(daysInMonth(month), dayOf(today))
    : month < currentMonth ? daysInMonth(month) : 0;
  const byDate = new Map();
  for (const tx of transactions) {
    if (!isBudgetExpense(tx) || !String(tx.date || "").startsWith(`${month}-`)) continue;
    const category = categoryNameBySource.get(tx.category) || tx.category || "Other";
    const categories = byDate.get(tx.date) || new Map();
    const group = categories.get(category) || { category, totalRaw: 0, transactions: [] };
    group.totalRaw += number(tx.amount);
    group.transactions.push(tx);
    categories.set(category, group);
    byDate.set(tx.date, categories);
  }
  let cumulativeRaw = 0;
  const days = Array.from({ length: lastDay }, (_, index) => {
    const date = `${month}-${String(index + 1).padStart(2, "0")}`;
    const categories = [...(byDate.get(date)?.values() || [])]
      .map((group) => ({ ...group, count: group.transactions.length,
        transactions: [...group.transactions].sort((a, b) => number(b.amount) - number(a.amount)) }))
      .sort((a, b) => Math.abs(b.totalRaw) - Math.abs(a.totalRaw));
    const dailyRaw = sum(categories, (group) => group.totalRaw);
    cumulativeRaw += dailyRaw;
    return { date, day: index + 1, dailyRaw, cumulativeRaw,
      count: sum(categories, (group) => group.count), categories };
  });
  return { days, defaultDate: days.at(-1)?.date || null };
}

export function buildForecastPoints(state, transactions, month) {
  const totalDays = daysInMonth(month);
  const byDay = transactions.filter(isBudgetExpense).reduce((result, tx) => {
    result[dayOf(tx.date)] = (result[dayOf(tx.date)] || 0) + number(tx.amount);
    return result;
  }, {});
  const incomeByDay = incomeRowsForMonth(state, month, false)
    .reduce((result, row) => {
      const cashDate = cashDateForIncome(row);
      if (!String(cashDate).startsWith(month)) return result;
      const day = dayOf(cashDate);
      result[day] = (result[day] || 0) + number(row.amount);
      return result;
    }, {});
  const goal = sum(state.categories || [], (cat) => cat.budget ?? cat.goal);
  let projected = number(state.openingBalance);
  let baseline = projected;
  const points = [];
  for (let day = 1; day <= totalDays; day += 1) {
    projected += number(incomeByDay[day]) - number(byDay[day]);
    baseline += number(incomeByDay[day]) - goal / totalDays;
    if (day === 1 || day === totalDays || day % 2 === 1) points.push({ day, date: monthShortDay(month, day), projected, baseline });
  }
  return points;
}

function incomeRowsForMonth(state, month, isActiveMonth) {
  const historyRows = (state.incomeHistory || []).filter((item) => {
    if (item.budgetMonth) return item.budgetMonth === month;
    return String(item.date || "").startsWith(month);
  });
  if (historyRows.length) return historyRows;
  if (!isActiveMonth) return (state.income || []).filter((item) => String(item.date || "").startsWith(month));
  return (state.income || []).map((item) => ({
    ...item,
    date: String(item.date || "").startsWith(month)
      ? item.date
      : `${month}-${String(item.day || 1).padStart(2, "0")}`,
    expected: item.expected ?? !String(item.actualDate || item.date || "").startsWith(month)
  }));
}

function cashDateForIncome(item) {
  if (item.expected) return item.date || item.actualDate || "";
  return item.actualDate || item.date || "";
}

function upcomingCashIncomeRows(state, month, isActiveMonth, balanceDate) {
  if (!isActiveMonth) return [];
  return incomeRowsForMonth(state, month, true).filter((item) => cashDateForIncome(item) > balanceDate);
}

function currentWeekStart(dateString) {
  const date = parseLocalDate(dateString);
  const mondayOffset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - mondayOffset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function daysThroughSunday(dateString, remainingDays) {
  const day = parseLocalDate(dateString).getDay();
  return Math.min(remainingDays, ((7 - day) % 7) + 1);
}

function buildGuardrailForecast(accountBalance, projectedEndBalance, bufferTarget, month, today) {
  const totalDays = daysInMonth(month);
  const startDay = Math.min(totalDays, Math.max(1, dayOf(today)));
  const span = Math.max(1, totalDays - startDay);
  const points = [];
  for (let day = startDay; day <= totalDays; day += 1) {
    const progress = day === totalDays ? 1 : (day - startDay) / span;
    if (day === startDay || day === totalDays || (day - startDay) % 2 === 0) {
      points.push({
        day,
        date: monthShortDay(month, day),
        projected: accountBalance + (projectedEndBalance - accountBalance) * progress,
        baseline: bufferTarget
      });
    }
  }
  return points;
}

export function buildIncomeReport(state, month, monthStatus, inflowTransactions, elapsedDay, isActiveMonth) {
  const incomeRows = [];
  const seen = new Set();

  function addRow(row) {
    const key = [
      row.date,
      Math.round(number(row.amount)),
      String(row.source || "").toLowerCase().replace(/\s+/g, " ").trim(),
      row.kind
    ].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    incomeRows.push(row);
  }

  inflowTransactions.forEach((tx) => {
    addRow({
      id: tx.id || tx.fingerprint || `${tx.date}-${tx.amount}-${tx.description || tx.merchant}`,
      source: tx.description || tx.merchant || tx.source || tx.category || "Incoming transaction",
      date: tx.date,
      amount: number(tx.amount),
      kind: classifyIncomeSource(tx),
      status: "Actual",
      detail: tx.source || tx.category || "Ledger transaction"
    });
  });

  const plannedIncomeRows = incomeRowsForMonth(state, month, isActiveMonth);

  plannedIncomeRows
    .forEach((item, index) => {
      const date = item.date || `${month}-${String(item.day || 1).padStart(2, "0")}`;
      const day = dayOf(date);
      const actualDate = item.actualDate && item.actualDate !== date ? ` · paid ${monthShortDayFromDate(item.actualDate)}` : "";
      addRow({
        id: item.id || `planned-income-${index}-${date}`,
        source: item.source || item.who || "Income",
        date,
        amount: number(item.amount),
        kind: classifyIncomeSource(item),
        status: item.expected ? "Expected" : item.actualDate ? "Received" : isActiveMonth && day > elapsedDay ? "Upcoming" : "Planned",
        detail: item.who ? `${item.who}${item.expected ? " · expected" : ""}${actualDate}` : item.sourceRef || (item.expected ? `Expected income${actualDate}` : `Other incoming${actualDate}`)
      });
    });

  const visibleTotal = sum(incomeRows, (item) => item.amount);
  const monthlyStatusIncome = number(monthStatus?.income);
  const reconciliation = monthlyStatusIncome - visibleTotal;
  if (monthlyStatusIncome > 0 && reconciliation > 1) {
    addRow({
      id: `income-reconciliation-${month}`,
      source: "Other income",
      date: `${month}-${String(daysInMonth(month)).padStart(2, "0")}`,
      amount: reconciliation,
      kind: "other",
      status: "Imported total",
      detail: "Monthly status amount not itemized in transactions"
    });
  }

  const sortedRows = incomeRows
    .sort((a, b) => String(b.date).localeCompare(String(a.date)) || number(b.amount) - number(a.amount))
    .map((row) => ({
      ...row,
      kindLabel: row.kind === "salary" ? "Salary" : "Other",
      dateLabel: monthShortDayFromDate(row.date),
      amountLabel: money(row.amount)
    }));

  const salaryTotal = sum(sortedRows.filter((item) => item.kind === "salary"), (item) => item.amount);
  const otherTotal = sum(sortedRows.filter((item) => item.kind !== "salary"), (item) => item.amount);
  const total = salaryTotal + otherTotal;

  return {
    total,
    totalLabel: money(total),
    salaryTotal,
    salaryTotalLabel: money(salaryTotal),
    otherTotal,
    otherTotalLabel: money(otherTotal),
    salaryShareLabel: total ? `${Math.round((salaryTotal / total) * 100)}% salaries` : "No income loaded",
    rows: sortedRows,
    categories: [
      {
        key: "salary",
        label: "Salaries",
        amount: salaryTotal,
        amountLabel: money(salaryTotal),
        share: total ? salaryTotal / total : 0,
        count: sortedRows.filter((item) => item.kind === "salary").length
      },
      {
        key: "other",
        label: "Other incoming",
        amount: otherTotal,
        amountLabel: money(otherTotal),
        share: total ? otherTotal / total : 0,
        count: sortedRows.filter((item) => item.kind !== "salary").length
      }
    ]
  };
}

export function buildScreenData(state, ledger, requestedMonth, today = new Date().toISOString().slice(0, 10), budgetBasis = "purchase", sharedState = {}) {
  const currentMonth = today.slice(0, 7);
  const allPurchaseEvents = purchaseEvents(ledger);
  const selectedBudgetEvents = budgetEvents(ledger, budgetBasis);
  const alternateEvents = budgetEvents(ledger, budgetBasis === "installments" ? "purchase" : "installments");
  const budgetAvailableMonths = monthsForTransactions([...allPurchaseEvents, ...installmentBudgetEvents(ledger)]);
  const allBillingEvents = billingEvents(ledger);
  const purchaseAvailableMonths = [...new Set([
    ...monthsForTransactions(allPurchaseEvents),
    state.month,
    currentMonth,
    requestedMonth
  ].filter((value) => /^\d{4}-\d{2}$/.test(value)))].sort();
  const billingAvailableMonths = [...new Set([
    ...monthsForTransactions(allBillingEvents),
    state.month,
    ...(state.monthlyStatus || []).map((row) => row.month),
    currentMonth,
    requestedMonth
  ].filter((value) => /^\d{4}-\d{2}$/.test(value)))].sort();
  const commitmentMonths = [...new Set([
    ...monthsForTransactions(projectedBillingEvents(ledger)),
    ...monthsForTransactions(allBillingEvents.filter(isCardTransaction)),
    currentMonth,
    requestedMonth
  ].filter((value) => /^\d{4}-\d{2}$/.test(value)))].sort();
  const availableMonths = [...new Set([
    ...billingAvailableMonths,
    ...purchaseAvailableMonths
  ])].sort();
  const month = requestedMonth || currentMonth || state.month || availableMonths.at(-1) || latestDate(ledger.transactions || [], today).slice(0, 7);
  let recurringPlan = buildRecurringPlan(ledger, month, today);
  let budgetCategories = categoriesWithRecurringMinimum(state.categories || [], recurringPlan);
  const recurringBudgetIncrease = budgetCategories.reduce(
    (total, category) => total + Math.max(0, category.budget - category.manualBudget),
    0,
  );
  const monthTransactions = allBillingEvents
    .filter((tx) => String(tx.date || "").startsWith(month));
  const purchaseMonthTransactions = selectedBudgetEvents
    .filter((tx) => String(tx.date || "").startsWith(month));
  const commitmentTransactions = monthTransactions.filter(isCardTransaction);
  const monthStatus = (state.monthlyStatus || []).find((row) => row.month === month);
  const hasClosingBalance = monthStatus?.closingBalance != null && Number.isFinite(Number(monthStatus.closingBalance));
  const isActiveMonth = month === currentMonth;
  const expenseTransactions = monthTransactions.filter(isBudgetExpense);
  const inflowTransactions = monthTransactions.filter(isIncomeTransaction);
  const lastActivityDate = isActiveMonth
    ? state.accountBalance?.date || latestVisibleDate(monthTransactions, `${month}-01`)
    : latestVisibleDate(monthTransactions, `${month}-${daysInMonth(month)}`);
  const elapsedDay = isActiveMonth ? Math.min(daysInMonth(month), Math.max(1, dayOf(lastActivityDate))) : daysInMonth(month);
  const calendarDay = isActiveMonth ? Math.min(daysInMonth(month), Math.max(1, dayOf(today))) : daysInMonth(month);
  const monthProgress = calendarDay / daysInMonth(month);
  const remainingDays = isActiveMonth ? Math.max(1, daysInMonth(month) - calendarDay + 1) : 0;
  const planningIncomeRows = incomeRowsForMonth(state, month, isActiveMonth);
  const income = number(monthStatus?.income) || sum(planningIncomeRows.length ? planningIncomeRows : inflowTransactions, (item) => item.amount);
  const balanceDate = isActiveMonth ? state.accountBalance?.date || lastActivityDate : lastActivityDate;
  const upcomingIncomeRows = upcomingCashIncomeRows(state, month, isActiveMonth, balanceDate);
  const upcomingIncome = sum(upcomingIncomeRows, (item) => item.amount);
  const spent = sum(expenseTransactions, (tx) => tx.amount);
  const purchaseExpenseTransactions = purchaseMonthTransactions.filter(isBudgetExpense);
  const purchaseSpent = sum(purchaseExpenseTransactions, (tx) => tx.amount);
  const budgetPlan = buildBudgetPlan(state, ledger, sharedState, month, purchaseExpenseTransactions, expenseTransactions, income, monthProgress);
  const recurringChildren = new Map(budgetPlan.subcategories.filter((row) => row.recurringCostId).map((row) => [row.recurringCostId, row]));
  recurringPlan = buildRecurringPlan({ ...ledger, recurringCosts: (ledger.recurringCosts || []).map((cost) => {
    const child = recurringChildren.get(cost.id);
    return child ? { ...cost, monthlyFunding: child.planned, included: !child.archived && child.planned > 0 } : cost;
  }) }, month, today);
  budgetCategories = budgetPlan.categories.map((category) => ({ name: category.name, budget: category.planned,
    spendingType: category.commitment === "flexible" || category.subcategories.some((child) => child.commitment === "flexible")
      ? "flexible" : "committed" }));
  const goalTotal = sum(budgetCategories, (cat) => cat.budget ?? cat.goal);
  const expectedSpend = goalTotal * monthProgress;
  const paceDelta = spent - expectedSpend;
  const purchasePaceDelta = purchaseSpent - expectedSpend;
  const accountBalance = isActiveMonth ? state.accountBalance?.amount ?? state.openingBalance ?? 0 : monthStatus?.closingBalance ?? 0;
  const budgetRemaining = Math.max(0, goalTotal - purchaseSpent);
  const cashBudgetRemaining = Math.max(0, goalTotal - spent);
  const latestBalanceAge = datediffDays(lastActivityDate, today);
  const budgetRows = buildBudgetRows(budgetCategories,
    budgetPlan.categories.map((category) => ({ category: category.name, amount: category.actual })), monthProgress);
  const categoryNameBySource = new Map(budgetPlan.categories.flatMap((category) =>
    [category.name, ...(category.sourceNames || [])].map((name) => [name, category.name])));
  const cashflowBudgetRows = buildBudgetRows(budgetCategories,
    expenseTransactions.map((tx) => ({ ...tx, category: categoryNameBySource.get(tx.category) || tx.category })), monthProgress);
  const incomeReport = buildIncomeReport(state, month, monthStatus, inflowTransactions, elapsedDay, isActiveMonth);
  const committedRows = cashflowBudgetRows.filter((row) => row.spendingType === "committed");
  const flexibleRows = cashflowBudgetRows.filter((row) => row.spendingType === "flexible");
  const spendingTypeByCategory = Object.fromEntries(cashflowBudgetRows.map((row) => [row.category, row.spendingType]));
  const recurringByCategory = Object.fromEntries(recurringPlan.byCategory.map((row) => [row.category, row]));
  const flexibleRecurringRemaining = sum(flexibleRows, (row) => number(recurringByCategory[row.category]?.remaining));
  const flexibleRecurringOverage = sum(flexibleRows, (row) => Math.max(0, number(recurringByCategory[row.category]?.actual) - number(recurringByCategory[row.category]?.planned)));
  const remainingCommittedCosts = budgetPlan.remainingCommittedCosts;
  const committedOverage = budgetPlan.committedOverage;
  const flexibleGoal = budgetPlan.flexiblePlanned;
  const flexibleSpent = budgetPlan.flexibleSpent;
  const bufferTarget = number(state.bufferTarget);
  const cashPool = accountBalance + upcomingIncome - remainingCommittedCosts - bufferTarget;
  const budgetPool = flexibleGoal - flexibleSpent - committedOverage;
  const limitingFactor = cashPool <= budgetPool ? "cash" : "budget";
  const safeSpendPool = isActiveMonth ? Math.max(0, Math.min(cashPool, budgetPool)) : 0;
  const safeDailySpend = isActiveMonth ? safeSpendPool / remainingDays : 0;
  const projectedEndBalance = isActiveMonth
    ? accountBalance + upcomingIncome - remainingCommittedCosts - safeSpendPool
    : accountBalance;
  const weekStart = currentWeekStart(today);
  const flexibleSpentToday = isActiveMonth
    ? sum(expenseTransactions.filter((tx) => tx.date === today && (spendingTypeByCategory[categoryNameBySource.get(tx.category) || tx.category] || categorySpendingType(tx.category)) === "flexible"), (tx) => tx.amount)
    : 0;
  const flexibleSpentThisWeek = isActiveMonth
    ? sum(expenseTransactions.filter((tx) => tx.date >= weekStart && tx.date <= today && (spendingTypeByCategory[categoryNameBySource.get(tx.category) || tx.category] || categorySpendingType(tx.category)) === "flexible"), (tx) => tx.amount)
    : 0;
  const daysLeftThisWeek = isActiveMonth ? daysThroughSunday(today, remainingDays) : 0;
  const safeThroughSunday = safeDailySpend * daysLeftThisWeek;
  const guardrailReason = !isActiveMonth
    ? "month_closed"
    : latestBalanceAge > 3
      ? "stale_balance"
      : limitingFactor === "cash" && cashPool <= 0
        ? "cash_shortfall"
        : limitingFactor === "budget" && flexibleGoal <= 0
          ? "missing_flexible_budget"
          : limitingFactor === "budget" && budgetPool <= 0
            ? "flexible_budget_exhausted"
            : limitingFactor;
  const watchRows = cashflowBudgetRows.filter((row) => ["risk", "watch"].includes(row.statusKey)).sort((a, b) => b.pace - a.pace);
  const unbudgetedRows = cashflowBudgetRows.filter((row) => row.statusKey === "unbudgeted").sort((a, b) => b.actual - a.actual);
  const allTransactions = decorateTransactions(monthTransactions);
  const purchaseTransactions = decorateTransactions(purchaseMonthTransactions);
  const commitmentRows = decorateTransactions(commitmentTransactions);
  const recentTransactions = allTransactions.slice(0, 10);
  const totalRemaining = goalTotal - purchaseSpent;
  const projectedRecurring = month < currentMonth ? 0 : recurringPlan.remaining;
  const expectedAfterRecurring = purchaseSpent + projectedRecurring;
  const remainingAfterRecurring = goalTotal - expectedAfterRecurring;
  const totalStatusKey = purchaseSpent > goalTotal ? "risk" : purchasePaceDelta > 0 ? "watch" : "ok";
  const weeklyReport = buildWeeklyReport(purchaseMonthTransactions, budgetRows, month, categoryNameBySource);
  const dailyReport = buildDailyReport(purchaseMonthTransactions, month, today, categoryNameBySource);
  const commitmentsByCard = commitmentRows.reduce((groups, tx) => {
    const card = transactionAccount(tx) || "Card statement";
    groups[card] ??= { card, total: 0, count: 0 };
    groups[card].total += number(tx.amount);
    groups[card].count += 1;
    return groups;
  }, {});
  const commitmentsByCategory = commitmentRows.reduce((groups, tx) => {
    const category = tx.category || "Other";
    groups[category] ??= { category, total: 0, count: 0 };
    groups[category].total += number(tx.amount);
    groups[category].count += 1;
    return groups;
  }, {});
  const actionSuggestions = buildGuardrailActions({
    guardrailReason,
    cashPool,
    budgetPool,
    latestBalanceAge,
    flexibleRows,
    watchRows,
    month
  });

  return {
    budgetBasis,
    budgetAvailableMonths: [...new Set([...budgetAvailableMonths, ...futureMonthRange(currentMonth, 12), month])].sort(),
    alternateBudgetTotal: sum(alternateEvents.filter((tx) => tx.date.startsWith(month) && isBudgetExpense(tx)), (tx) => tx.amount),
    allocationEstimatedTotal: sum(purchaseMonthTransactions.filter((tx) => tx.allocationEstimated), (tx) => tx.amount),
    allocationReviewCount: new Set(purchaseMonthTransactions.filter((tx) => tx.allocationWarning).map((tx) => tx.installmentPlanId || tx.id)).size,
    projectedCommitmentRows: decorateTransactions(projectedBillingEvents(ledger).filter((tx) => tx.date.startsWith(month))),
    budgetTransactions: purchaseTransactions,
    budgetSuggestions: budgetRows.filter((row) => row.actual > 0).sort((a, b) => b.actual - a.actual).slice(0, 3).map((row) => ({
      category: row.category, status: row.statusKey, icon: row.icon,
      href: `#activity?month=${month}&basis=${budgetBasis}&category=${encodeURIComponent(row.category)}`,
      text: `${row.category}: ${row.actualLabel}${row.hasGoal ? ` against ${row.goalLabel} planned` : " without a monthly goal"}`
    })),
    month,
    monthLabel: formatMonth(month),
    availableMonths,
    purchaseAvailableMonths,
    billingAvailableMonths,
    commitmentMonths,
    isActiveMonth,
    recurringPlan: {
      ...recurringPlan,
      budgetIncrease: recurringBudgetIncrease,
    },
    budgetProjection: {
      isClosed: month < currentMonth,
      isFuture: month > currentMonth,
      spent: purchaseSpent,
      upcomingRecurring: projectedRecurring,
      expectedAfterRecurring,
      remainingAfterRecurring,
      goal: goalTotal,
      statusKey: remainingAfterRecurring < 0 ? "risk" : "ok",
    },
    summary: {
      projectedEndBalance,
      projectedEndBalanceLabel: money(projectedEndBalance),
      safeDailySpend,
      safeDailySpendLabel: `${money(safeDailySpend)}/day`,
      safeSpendPool,
      safeSpendPoolLabel: money(safeSpendPool),
      cashPool,
      cashPoolLabel: money(cashPool),
      budgetPool,
      budgetPoolLabel: money(budgetPool),
      limitingFactor,
      limitingFactorLabel: limitingFactor === "cash" ? "Cash coverage" : "Flexible budget",
      guardrailReason,
      guardrailStatus: !isActiveMonth ? "Closed" : latestBalanceAge > 3 ? "Update data" : safeSpendPool > 0 ? "On track" : "Needs attention",
      guardrailDetail: guardrailReason === "stale_balance"
        ? `Balance is ${latestBalanceAge} days old`
        : guardrailReason === "cash_shortfall"
          ? `${money(Math.abs(cashPool))} short of commitments and buffer`
          : guardrailReason === "missing_flexible_budget"
            ? "No flexible category goals are set"
            : guardrailReason === "flexible_budget_exhausted"
              ? `${money(Math.abs(Math.min(0, budgetPool)))} beyond the flexible allowance`
              : `${limitingFactor === "cash" ? "Cash coverage" : "Flexible budget"} sets the limit`,
      runwayStatus: isActiveMonth ? projectedEndBalance >= bufferTarget ? "Safe" : "Needs attention" : "Closed",
      runwayLabel: isActiveMonth ? `through ${monthShortDay(month, daysInMonth(month))}` : `ended ${monthShortDay(month, daysInMonth(month))}`,
      dataUpdatedLabel: isActiveMonth ? latestBalanceAge === 0 ? "today" : `${latestBalanceAge} day${latestBalanceAge === 1 ? "" : "s"} ago` : "closed month",
      currentBankBalanceLabel: money(accountBalance),
      incomeThisMonthLabel: money(income),
      spentThisMonthLabel: money(spent),
      spentIncomeRatio: income ? `${Math.round((spent / income) * 100)}% of income` : "No income loaded",
      budgetRemainingLabel: money(cashBudgetRemaining),
      bufferTargetLabel: money(bufferTarget),
      bufferTarget,
      currentBankBalance: accountBalance,
      balanceAsOf: balanceDate,
      hasClosingBalance,
      hasObservedBalance: Boolean(state.accountBalance && Number.isFinite(Number(state.accountBalance.amount))),
      totalBudgetGoal: goalTotal,
      totalCashBudgetRemaining: goalTotal - spent,
      upcomingIncomeRows: upcomingIncomeRows.map((row) => ({ source: row.source || row.who || "Income", amount: number(row.amount), date: cashDateForIncome(row), expected: Boolean(row.expected) })),
      incomeThisMonth: income,
      spentThisMonth: spent,
      budgetRemaining: cashBudgetRemaining,
      remainingDays,
      upcomingIncome,
      upcomingIncomeLabel: money(upcomingIncome),
      upcomingIncomeCount: upcomingIncomeRows.length,
      remainingCommittedCosts,
      remainingCommittedCostsLabel: money(remainingCommittedCosts),
      committedOverage,
      committedOverageLabel: money(committedOverage),
      flexibleGoal,
      flexibleGoalLabel: money(flexibleGoal),
      flexibleSpent,
      flexibleSpentLabel: money(flexibleSpent),
      flexibleSpentToday,
      flexibleSpentTodayLabel: money(flexibleSpentToday),
      flexibleSpentThisWeek,
      flexibleSpentThisWeekLabel: money(flexibleSpentThisWeek),
      safeThroughSunday,
      safeThroughSundayLabel: money(safeThroughSunday),
      daysLeftThisWeek,
      latestBalanceAge
    },
    whyItems: buildWhyItems(watchRows, latestBalanceAge, paceDelta, { guardrailReason, cashPool, budgetPool, safeSpendPool }),
    watchItems: watchRows.slice(0, 4),
    unbudgetedItems: unbudgetedRows,
    glanceItems: [
      { icon: "bank", title: isActiveMonth ? "Current bank balance" : "Closing balance", value: isActiveMonth || hasClosingBalance ? money(accountBalance) : "—", detail: isActiveMonth || hasClosingBalance ? `As of ${monthShortDayFromDate(lastActivityDate)}` : "No month-end balance imported", tone: "neutral" },
      { icon: "down", title: "Income this month", value: money(income), detail: `${upcomingIncomeRows.length} upcoming`, tone: "ok" },
      { icon: "up", title: "Spent this month", value: money(spent), detail: income ? `${Math.round((spent / income) * 100)}% of income` : "No income loaded", tone: "watch" },
      { icon: "calendar", title: "Budget remaining", value: money(cashBudgetRemaining), detail: isActiveMonth ? `${remainingDays} days left` : "Month closed", tone: "neutral" }
    ],
    budgetSummary: [
      { icon: "receipt", label: "Total remaining", value: money(Math.abs(totalRemaining)), detail: totalRemaining < 0 ? "over total goal" : `left of ${money(goalTotal)} goal`, tone: totalStatusKey },
      { icon: "trend", label: "You are", value: money(Math.abs(purchasePaceDelta)), detail: `${purchasePaceDelta > 0 ? "ahead of" : "under"} budget pace`, tone: purchasePaceDelta > 0 ? "watch" : "ok" },
      { icon: "calendar", label: "", value: String(remainingDays), detail: isActiveMonth ? `days left in ${formatMonth(month).split(" ")[0]}` : "month closed", tone: "blue" },
      { icon: "target", label: "Cash-based daily limit", value: money(safeDailySpend), detail: isActiveMonth ? "Independent of Budget cost mode" : "month closed", tone: safeSpendPool > 0 ? "ok" : "risk" },
      { icon: "down", label: "Spent vs salary", value: income ? `${Math.round((purchaseSpent / income) * 100)}%` : "n/a", detail: income ? `${money(purchaseSpent)} of ${money(income)} income` : "No income loaded", tone: income && purchaseSpent > income ? "risk" : "ok" }
    ],
    budgetTotal: { category: "Total", goal: goalTotal, actual: purchaseSpent, remaining: totalRemaining, status: totalStatusKey === "risk" ? "Over" : totalStatusKey === "watch" ? "Watch" : "On track", statusKey: totalStatusKey },
    budgetPlan,
    budgetRows,
    incomeReport,
    weeklyReport,
    dailyReport,
    forecastPoints: isActiveMonth
      ? buildGuardrailForecast(accountBalance, projectedEndBalance, bufferTarget, month, today)
      : buildForecastPoints(state, monthTransactions, month),
    actionSuggestions,
    recentTransactions,
    allTransactions,
    purchaseTransactions,
    commitmentRows,
    commitments: {
      total: sum(commitmentRows, (tx) => tx.amount),
      totalLabel: money(sum(commitmentRows, (tx) => tx.amount)),
      count: commitmentRows.length,
      byCard: Object.values(commitmentsByCard).sort((left, right) => right.total - left.total),
      byCategory: Object.values(commitmentsByCategory).sort((left, right) => right.total - left.total)
    },
    importRuns: ledger.importRuns || [],
    accounts: ledger.accounts || [],
    actions: state.actions || []
  };
}

function buildGuardrailActions({ guardrailReason, cashPool, budgetPool, flexibleRows, watchRows, month }) {
  const actions = [];
  if (guardrailReason === "stale_balance") {
    actions.push({ category: "", href: `#activity?month=${month}`, icon: "bank", status: "risk", text: "Confirm the latest balance before relying on today’s limit" });
  } else if (guardrailReason === "cash_shortfall") {
    actions.push({ category: "", href: `#budget?month=${month}`, icon: "bank", status: "risk", text: `Cover the ${money(Math.abs(cashPool))} commitments-and-buffer shortfall` });
  } else if (guardrailReason === "missing_flexible_budget") {
    actions.push({ category: "", href: "#settings?panel=budgets", icon: "target", status: "watch", text: "Set at least one flexible category goal" });
  } else if (guardrailReason === "flexible_budget_exhausted") {
    actions.push({ category: "", href: `#budget?month=${month}`, icon: "target", status: "risk", text: `Pause flexible spending; the allowance is ${money(Math.abs(Math.min(0, budgetPool)))} over` });
  } else {
    actions.push({ category: "", href: `#budget?month=${month}`, icon: "target", status: "ok", text: `Keep total flexible spending within ${money(Math.max(0, budgetPool))}` });
  }

  const flexiblePressure = [...flexibleRows]
    .filter((row) => row.actual > 0 || row.hasGoal)
    .sort((a, b) => (b.hasGoal ? b.actual / Math.max(1, b.goal) : b.actual) - (a.hasGoal ? a.actual / Math.max(1, a.goal) : a.actual))[0];
  if (flexiblePressure) {
    actions.push({
      category: flexiblePressure.category,
      href: `#activity?month=${month}&category=${encodeURIComponent(flexiblePressure.category)}`,
      icon: categoryIcon(flexiblePressure.category),
      status: flexiblePressure.statusKey,
      text: flexiblePressure.hasGoal
        ? `Keep ${flexiblePressure.category} under ${money(Math.max(0, flexiblePressure.remaining))} for the rest of the month`
        : `Set a goal or reduce unbudgeted ${flexiblePressure.category} spending`
    });
  }

  const pressure = watchRows.find((row) => row.category !== flexiblePressure?.category);
  if (pressure) {
    actions.push({
      category: pressure.category,
      href: `#activity?month=${month}&category=${encodeURIComponent(pressure.category)}`,
      icon: categoryIcon(pressure.category),
      status: pressure.statusKey,
      text: pressure.statusKey === "risk" ? `Review ${pressure.category} spending` : `${pressure.category} is ahead of monthly pace`
    });
  }
  return actions.slice(0, 3);
}

export function buildWhyItems(watchRows, latestBalanceAge, paceDelta, guardrail = {}) {
  const items = [];
  if (guardrail.guardrailReason === "cash_shortfall") {
    items.push({
      status: "risk",
      title: "Committed costs are not fully covered",
      description: `${money(Math.abs(guardrail.cashPool))} is missing after reserving unpaid commitments and the comfort buffer.`
    });
  } else if (["missing_flexible_budget", "flexible_budget_exhausted"].includes(guardrail.guardrailReason)) {
    items.push({
      status: "risk",
      title: guardrail.guardrailReason === "missing_flexible_budget" ? "Flexible budget needs a goal" : "Flexible budget is exhausted",
      description: guardrail.guardrailReason === "missing_flexible_budget"
        ? "Set a flexible category goal before the app authorizes discretionary spending."
        : `${money(Math.abs(Math.min(0, guardrail.budgetPool)))} has been spent beyond the flexible allowance.`
    });
  } else if (guardrail.safeSpendPool > 0) {
    items.push({
      status: "ok",
      title: `${guardrail.guardrailReason === "cash" ? "Cash coverage" : "Flexible budget"} sets today’s limit`,
      description: `${money(guardrail.safeSpendPool)} remains available through month-end after all guardrails.`
    });
  }
  const top = watchRows[0];
  if (top) {
    items.push({
      status: top.statusKey,
      title: `${top.category} is ${top.statusKey === "risk" ? `${money(Math.abs(top.remaining))} over goal` : `${money(top.pace)} ahead`}`,
      description: `${top.category} has the clearest pressure against the current budget goal.`
    });
  }
  items.push({
    status: paceDelta > 0 ? "watch" : "ok",
    title: paceDelta > 0 ? "Spending is ahead of pace" : "Spending is within pace",
    description: paceDelta > 0 ? "Actual spending is above the expected budget pace for this point in the month." : "Logged spending is at or below expected pace for this point in the month."
  });
  if (latestBalanceAge > 3 || items.length < 3) {
    items.push({
      status: latestBalanceAge > 3 ? "risk" : "ok",
      title: latestBalanceAge > 3 ? "Balance needs a quick check" : "Balance is recently confirmed",
      description: latestBalanceAge > 3 ? "The latest bank balance is older than the weekly check target." : "The latest observed balance is fresh enough for a useful forecast."
    });
  }
  return items.slice(0, 3);
}

export function monthShortDay(month, day) {
  const date = parseLocalDate(`${month}-${String(day).padStart(2, "0")}`);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

export function monthShortDayFromDate(dateString) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parseLocalDate(dateString));
}
