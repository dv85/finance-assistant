const FLEXIBLE_DEFAULTS = new Set(["Groceries", "Dining", "Transport", "Shopping", "Travel", "Cash", "Personal Care", "Entertainment"]);

const amount = (value) => Number(value || 0);
const cents = (value) => Math.round(amount(value) * 100) / 100;
const legacyId = (kind, value) => `legacy:${kind}:${encodeURIComponent(value)}`;
export const budgetMatchKey = (value) => String(value || "").trim().toLocaleLowerCase();
const isGeneral = (row) => row.id?.startsWith("legacy:general:");
const sum = (rows, key = "amount") => cents((rows || []).reduce((total, row) => total + amount(row[key]), 0));

function upgradeCatalog(raw, month, saved, sharedState) {
  if (raw.schemaVersion === 2) return structuredClone(raw);
  const values = Object.fromEntries(raw.subcategories.map((row) => [row.id,
    row.archived || row.schedule === "one-time" && row.dueMonth !== month ? 0 : cents(saved?.[row.id] ?? row.defaultAmount)]));
  const recurringOverrides = sharedState.recurringOverridesByMonth?.[month] || {};
  for (const row of raw.subcategories) {
    const override = row.recurringCostId && recurringOverrides[row.recurringCostId];
    if (override && saved?.[row.id] === undefined) values[row.id] = override.included === false ? 0 : cents(override.amount);
  }
  for (const category of raw.categories) {
    const override = sharedState.budgetOverridesByMonth?.[month]?.[category.name];
    const general = raw.subcategories.find((row) => row.id === legacyId("general", category.name));
    if (override === undefined || !general || saved?.[general.id] !== undefined) continue;
    const others = raw.subcategories.filter((row) => row.categoryId === category.id && row.id !== general.id)
      .reduce((total, row) => total + amount(values[row.id]), 0);
    values[general.id] = cents(Math.max(0, amount(override) - others));
  }
  return { schemaVersion: 2,
    categories: raw.categories.map((row) => ({ ...row,
      commitment: raw.subcategories.find((child) => child.categoryId === row.id && isGeneral(child))?.commitment || "flexible",
      defaultAmount: cents(raw.subcategories.filter((child) => child.categoryId === row.id)
        .reduce((total, child) => total + amount(values[child.id]), 0)) })),
    subcategories: raw.subcategories.filter((row) => !isGeneral(row)).map((row) => ({ ...row,
      kind: row.recurringCostId || row.schedule !== "none" ? "cost" : "group",
      targetEnabled: !row.recurringCostId && row.schedule === "none", defaultAmount: amount(values[row.id]) })),
  };
}

export function legacyBudgetCatalog(state, ledger) {
  const sourceCategories = state.categories || [];
  const names = [...new Set([
    ...sourceCategories.map((row) => row.name ?? row.category),
    ...(ledger.recurringCosts || []).map((row) => row.category),
  ].filter(Boolean))];
  const categories = names.map((name, order) => ({ id: legacyId("category", name), name, sourceNames: [name], order, archived: false }));
  const subcategories = [];
  for (const category of categories) {
    const source = sourceCategories.find((row) => (row.name ?? row.category) === category.name);
    const recurring = (ledger.recurringCosts || []).filter((row) => row.category === category.name);
    const recurringTotal = recurring.reduce((total, row) => total + (row.included === false ? 0 : amount(row.monthlyFunding)), 0);
    const manual = amount(source?.budget ?? source?.goal);
    subcategories.push({
      id: legacyId("general", category.name), categoryId: category.id, name: "General",
      order: 0, archived: false, commitment: source?.spendingType || (FLEXIBLE_DEFAULTS.has(category.name) ? "flexible" : "committed"),
      schedule: "none", defaultAmount: cents(Math.max(0, manual - recurringTotal)), sourceLabels: [category.name],
    });
    recurring.forEach((cost, index) => subcategories.push({
      id: `recurring:${cost.id}`, categoryId: category.id, name: cost.name || "Recurring cost",
      order: index + 1, archived: false, commitment: "committed", schedule: "monthly",
      defaultAmount: cents(cost.included === false ? 0 : cost.monthlyFunding), recurringCostId: cost.id, sourceLabels: [],
    }));
  }
  return { categories, subcategories };
}

export function resolveBudgetCatalog(state, ledger, sharedState = {}, month) {
  const revisions = (sharedState.budgetCatalogVersions || []).filter((row) => row.effectiveFromMonth <= month)
    .sort((a, b) => a.effectiveFromMonth.localeCompare(b.effectiveFromMonth));
  const latest = revisions.at(-1);
  const raw = latest?.catalog || legacyBudgetCatalog(state, ledger);
  const saved = sharedState.budgetMonthPlans?.[month];
  const catalog = upgradeCatalog(raw, month, saved, sharedState);
  const allocations = Object.fromEntries([
    ...catalog.categories.map((row) => [row.id, cents(row.defaultAmount)]),
    ...catalog.subcategories.filter((row) => row.kind === "cost" || row.targetEnabled)
      .map((row) => [row.id, row.schedule === "one-time" && row.dueMonth !== month ? 0 : cents(row.defaultAmount)]),
  ]);
  const baselineAllocations = { ...allocations };
  if (saved) for (const [id, value] of Object.entries(saved)) if (id in allocations &&
    (raw.schemaVersion === 2 || catalog.categories.some((row) => row.id === id))) allocations[id] = cents(value);
  // Old month edits can outlive an upgrade to the category-first catalog.
  if (saved && raw.schemaVersion === 2 && !catalog.categories.some((row) => Object.hasOwn(saved, row.id))) {
    const previous = [...(sharedState.budgetCatalogVersions || [])].filter((row) => row.catalog?.schemaVersion !== 2)
      .sort((a, b) => a.effectiveFromMonth.localeCompare(b.effectiveFromMonth)).at(-1)?.catalog;
    if (previous) {
      const migrated = upgradeCatalog(previous, month, saved, sharedState);
      for (const row of catalog.categories) {
        const old = migrated.categories.find((item) => item.id === row.id);
        if (old) allocations[row.id] = old.defaultAmount;
      }
    }
  }
  const archivedCategories = new Set(catalog.categories.filter((row) => row.archived).map((row) => row.id));
  for (const category of catalog.categories) if (category.archived) allocations[category.id] = 0;
  for (const child of catalog.subcategories) if (child.archived || archivedCategories.has(child.categoryId)) allocations[child.id] = 0;
  return { ...catalog, allocations, baselineAllocations, saved: Boolean(saved), source: latest ? "shared" : "legacy" };
}

export function resolveBudgetMatchBindings(state, ledger, sharedState = {}) {
  if (Array.isArray(sharedState.budgetMatchBindings)) return sharedState.budgetMatchBindings.filter((row) =>
    !String(row.subcategoryId).startsWith("legacy:general:"));
  const versions = [...(sharedState.budgetCatalogVersions || [])].sort((a, b) => a.effectiveFromMonth.localeCompare(b.effectiveFromMonth));
  const catalog = versions.at(-1)?.catalog || legacyBudgetCatalog(state, ledger);
  const categories = new Map(catalog.categories.map((row) => [row.id, row]));
  const claimed = new Set();
  const bindings = [];
  for (const child of catalog.subcategories.filter((row) => !isGeneral(row))) {
    const category = categories.get(child.categoryId);
    if (!category) continue;
    const sourceCategory = category.sourceNames?.[0] || category.name;
    const candidates = child.recurringCostId
      ? [{ kind: "recurring", sourceKey: child.recurringCostId }]
      : (child.sourceLabels?.length ? child.sourceLabels : [child.name]).map((sourceKey) => ({ kind: "label", sourceKey }));
    for (const candidate of candidates) {
      const key = `${candidate.kind}:${budgetMatchKey(sourceCategory)}:${budgetMatchKey(candidate.sourceKey)}`;
      if (!budgetMatchKey(candidate.sourceKey) || claimed.has(key)) continue;
      claimed.add(key);
      bindings.push({ ...candidate, categoryId: category.id, subcategoryId: child.id, sourceCategory });
    }
  }
  return bindings;
}

export function bindingMatchesTransaction(binding, transaction) {
  if (budgetMatchKey(binding.sourceCategory) !== budgetMatchKey(transaction.category || "Other")) return false;
  if (binding.kind === "recurring") return transaction.recurringReviewed === true &&
    budgetMatchKey(binding.sourceKey) === budgetMatchKey(transaction.recurringCostId);
  if (binding.kind === "transaction") return transaction.categoryReviewed === true &&
    [transaction.id, transaction.sourceTransactionId].some((id) => String(binding.sourceKey) === String(id || ""));
  return binding.kind === "label" && transaction.categoryReviewed === true &&
    budgetMatchKey(binding.sourceKey) === budgetMatchKey(transaction.costLabel);
}

export function linkedTransactionCount(binding, bindings, transactions) {
  const sameSource = bindings.filter((row) => row.kind === binding.kind &&
    budgetMatchKey(row.sourceCategory) === budgetMatchKey(binding.sourceCategory) &&
    budgetMatchKey(row.sourceKey) === budgetMatchKey(binding.sourceKey));
  if (sameSource.length > 1) return 0;
  return transactions.filter((transaction) => bindingMatchesTransaction(binding, transaction) &&
    (binding.kind === "recurring" || !bindings.some((row) => row.kind === "recurring" && bindingMatchesTransaction(row, transaction))) &&
    (binding.kind !== "label" || !bindings.some((row) => row.kind === "transaction" && bindingMatchesTransaction(row, transaction)))).length;
}

function matchSubcategory(transaction, category, catalog, bindings) {
  for (const kind of ["recurring", "transaction", "label"]) {
    const matches = bindings.filter((row) => row.kind === kind && row.categoryId === category.id && bindingMatchesTransaction(row, transaction));
    if (matches.length > 1) return null;
    const binding = matches[0];
    if (!binding) continue;
    const child = catalog.subcategories.find((row) => row.id === binding.subcategoryId && row.categoryId === category.id);
    if (child && !child.archived && !category.archived) return child;
    return null;
  }
  return null;
}

function includeHistoricalMatches(catalog, latestCatalog, bindings, transactions) {
  const latestCategories = new Map(latestCatalog.categories.map((row) => [row.id, row]));
  const latestChildren = new Map(latestCatalog.subcategories.map((row) => [row.id, row]));
  for (const binding of bindings) {
    if (!transactions.some((transaction) => bindingMatchesTransaction(binding, transaction))) continue;
    const latestCategory = latestCategories.get(binding.categoryId);
    const latestChild = latestChildren.get(binding.subcategoryId);
    if (!latestCategory || !latestChild || latestChild.categoryId !== latestCategory.id) continue;
    if (!catalog.categories.some((row) => row.id === latestCategory.id)) {
      catalog.categories.push({ ...latestCategory, archived: false, addedLater: true });
    }
    const selectedCategory = catalog.categories.find((row) => row.id === latestCategory.id);
    if (selectedCategory && ![selectedCategory.name, ...(selectedCategory.sourceNames || [])]
      .some((name) => budgetMatchKey(name) === budgetMatchKey(binding.sourceCategory))) {
      selectedCategory.sourceNames = [...(selectedCategory.sourceNames || []), binding.sourceCategory];
    }
    if (!catalog.subcategories.some((row) => row.id === latestChild.id)) {
      catalog.subcategories.push({ ...latestChild, archived: false, defaultAmount: 0, addedLater: true });
      catalog.allocations[latestChild.id] = 0;
      catalog.baselineAllocations[latestChild.id] = 0;
    }
  }
}

function assignActuals(catalog, transactions, bindings) {
  const bySubcategory = Object.fromEntries(catalog.subcategories.map((row) => [row.id, 0]));
  const unassigned = Object.fromEntries(catalog.categories.map((row) => [row.id, 0]));
  const transactionGroups = {
    byCategory: Object.fromEntries(catalog.categories.map((row) => [row.id, []])),
    bySubcategory: Object.fromEntries(catalog.subcategories.map((row) => [row.id, []])),
    unassigned: Object.fromEntries(catalog.categories.map((row) => [row.id, []])),
    matchByTransaction: {},
  };
  const byCategoryName = new Map(catalog.categories.flatMap((row) => [row.name, ...(row.sourceNames || [])].map((name) => [budgetMatchKey(name), row])));
  for (const transaction of transactions) {
    const category = byCategoryName.get(budgetMatchKey(transaction.category || "Other"));
    if (!category) continue;
    transactionGroups.byCategory[category.id].push(transaction);
    const subcategory = matchSubcategory(transaction, category, catalog, bindings);
    if (subcategory) {
      bySubcategory[subcategory.id] += amount(transaction.amount);
      transactionGroups.bySubcategory[subcategory.id].push(transaction);
      if (transaction.id) transactionGroups.matchByTransaction[transaction.id] = subcategory.id;
      if (subcategory.kind === "cost" && subcategory.parentSubcategoryId &&
        catalog.subcategories.some((row) => row.id === subcategory.parentSubcategoryId && !row.archived) &&
        bySubcategory[subcategory.parentSubcategoryId] !== undefined) {
        bySubcategory[subcategory.parentSubcategoryId] += amount(transaction.amount);
        transactionGroups.bySubcategory[subcategory.parentSubcategoryId].push(transaction);
      }
    } else {
      unassigned[category.id] += amount(transaction.amount);
      transactionGroups.unassigned[category.id].push(transaction);
    }
  }
  return { bySubcategory, unassigned, transactionGroups };
}

export function buildBudgetPlan(state, ledger, sharedState, month, budgetTransactions, cashTransactions, income, monthProgress) {
  const catalog = resolveBudgetCatalog(state, ledger, sharedState, month);
  const bindings = resolveBudgetMatchBindings(state, ledger, sharedState);
  const versions = [...(sharedState.budgetCatalogVersions || [])].sort((a, b) => a.effectiveFromMonth.localeCompare(b.effectiveFromMonth));
  const latestRaw = versions.at(-1)?.catalog || legacyBudgetCatalog(state, ledger);
  includeHistoricalMatches(catalog, upgradeCatalog(latestRaw, month, {}, sharedState), bindings,
    [...budgetTransactions, ...cashTransactions]);
  const seen = new Set(catalog.categories.flatMap((row) => [row.name, ...(row.sourceNames || [])].map(budgetMatchKey)));
  for (const transaction of [...budgetTransactions, ...cashTransactions]) {
    const name = transaction.category || "Other";
    if (seen.has(budgetMatchKey(name))) continue;
    seen.add(budgetMatchKey(name));
    const id = legacyId("unplanned", name);
    catalog.categories.push({ id, name, order: catalog.categories.length, archived: false,
      defaultAmount: 0, commitment: "flexible" });
    catalog.allocations[id] = 0;
    catalog.baselineAllocations[id] = 0;
  }
  const budgetActual = assignActuals(catalog, budgetTransactions, bindings);
  const cashActual = assignActuals(catalog, cashTransactions, bindings);
  const subcategories = catalog.subcategories.map((row) => {
    const planned = row.kind === "cost" || row.targetEnabled ? amount(catalog.allocations[row.id]) : null;
    const actual = cents(budgetActual.bySubcategory[row.id]);
    const cashSpent = cents(cashActual.bySubcategory[row.id]);
    return { ...row, planned, actual, cashSpent, remaining: planned === null ? null : cents(planned - actual),
      expected: planned === null ? null : cents(planned * monthProgress),
      status: planned === null ? "Group only" : planned === 0 && actual > 0 ? "No target" : actual > planned ? "Over" : "On track" };
  });
  const categories = catalog.categories.map((row) => {
    const children = subcategories.filter((child) => child.categoryId === row.id).sort((a, b) => a.order - b.order);
    const planned = amount(catalog.allocations[row.id]);
    const actual = sum(budgetActual.transactionGroups.byCategory[row.id]);
    return { ...row, subcategories: children, planned, actual, unassigned: cents(budgetActual.unassigned[row.id]),
      remaining: cents(planned - actual) };
  });
  let committedPlanned = 0, flexiblePlanned = 0, periodicPlanned = 0;
  let remainingCommittedCosts = 0, committedOverage = 0, flexibleSpent = 0;
  for (const category of categories) {
    const groups = category.subcategories.filter((row) => row.kind === "group" && row.targetEnabled && !row.addedLater);
    const costs = category.subcategories.filter((row) => row.kind === "cost" && !row.addedLater);
    const ungroupedCosts = costs.filter((row) => !groups.some((group) => group.id === row.parentSubcategoryId));
    const reserved = groups.reduce((total, row) => total + row.planned, 0) +
      ungroupedCosts.reduce((total, row) => total + row.planned, 0);
    const reservedCash = groups.reduce((total, row) => total + row.cashSpent, 0) +
      ungroupedCosts.reduce((total, row) => total + row.cashSpent, 0);
    const buckets = costs.map((row) => ({ planned: row.planned, spent: row.cashSpent, commitment: row.commitment }));
    for (const group of groups) {
      const inside = costs.filter((row) => row.parentSubcategoryId === group.id);
      buckets.push({ planned: Math.max(0, group.planned - inside.reduce((total, row) => total + row.planned, 0)),
        spent: Math.max(0, group.cashSpent - inside.reduce((total, row) => total + row.cashSpent, 0)),
        commitment: group.commitment });
    }
    buckets.push({ planned: Math.max(0, category.planned - reserved),
      spent: Math.max(0, sum(cashActual.transactionGroups.byCategory[category.id]) - reservedCash),
      commitment: category.commitment || "flexible" });
    periodicPlanned += costs.filter((row) => row.schedule === "periodic" || row.schedule === "one-time")
      .reduce((total, row) => total + row.planned, 0);
    for (const bucket of buckets) {
      if (bucket.commitment === "committed") {
        committedPlanned += bucket.planned;
        remainingCommittedCosts += Math.max(0, bucket.planned - bucket.spent);
        committedOverage += Math.max(0, bucket.spent - bucket.planned);
      } else {
        flexiblePlanned += bucket.planned;
        flexibleSpent += bucket.spent;
      }
    }
  }
  const total = cents(categories.reduce((value, row) => value + row.planned, 0));
  return {
    ...catalog, categories, subcategories, total, income: cents(income), committedPlanned: cents(committedPlanned),
    flexiblePlanned: cents(flexiblePlanned), periodicPlanned: cents(periodicPlanned),
    unallocated: cents(amount(income) - total),
    unassignedCash: cents(Object.values(cashActual.unassigned).reduce((total, value) => total + amount(value), 0)),
    remainingCommittedCosts: cents(remainingCommittedCosts), committedOverage: cents(committedOverage), flexibleSpent: cents(flexibleSpent),
    transactionGroups: budgetActual.transactionGroups,
  };
}
