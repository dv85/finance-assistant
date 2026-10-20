"use client";

import { useEffect, useState } from "react";
import { saveBudgetPlan } from "./lib/dataSource.js";
import { formatMonth, isBudgetExpense, money, number } from "./lib/finance.js";
import { bindingMatchesTransaction, budgetMatchKey, linkedTransactionCount, resolveBudgetMatchBindings } from "./lib/budgetPlan.js";

const todayMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};
const round = (value) => Math.round(number(value) * 100) / 100;
const ordered = (rows) => [...rows].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
function committedTotal(catalog, allocations) {
  let total = 0;
  for (const category of catalog.categories.filter((row) => !row.archived)) {
    const children = catalog.subcategories.filter((row) => row.categoryId === category.id && !row.archived);
    const groups = children.filter((row) => row.kind === "group" && row.targetEnabled);
    const costs = children.filter((row) => row.kind === "cost");
    const reserved = groups.reduce((sum, row) => sum + number(allocations[row.id]), 0) +
      costs.filter((row) => !groups.some((group) => group.id === row.parentSubcategoryId))
        .reduce((sum, row) => sum + number(allocations[row.id]), 0);
    total += costs.filter((row) => row.commitment === "committed").reduce((sum, row) => sum + number(allocations[row.id]), 0);
    total += groups.filter((row) => row.commitment === "committed").reduce((sum, row) => sum + Math.max(0,
      number(allocations[row.id]) - costs.filter((cost) => cost.parentSubcategoryId === row.id)
        .reduce((inside, cost) => inside + number(allocations[cost.id]), 0)), 0);
    if (category.commitment === "committed") total += Math.max(0, number(allocations[category.id]) - reserved);
  }
  return round(total);
}
const cleanCatalog = (plan) => ({
  schemaVersion: 2,
  categories: plan.categories.map(({ id, name, sourceNames, order, archived, addedLater, commitment, defaultAmount }) =>
    ({ id, name, sourceNames: sourceNames || [], order, archived, addedLater,
      commitment: commitment || "flexible", defaultAmount: number(defaultAmount) })),
  subcategories: plan.subcategories.map(({ id, categoryId, name, order, archived, addedLater, commitment, schedule, defaultAmount, recurringCostId, sourceLabels, expectedAmount, intervalMonths, dueMonth, kind, targetEnabled, parentSubcategoryId }) => ({
    id, categoryId, name, order, archived, addedLater, commitment, schedule, defaultAmount,
    kind: kind || (recurringCostId || schedule !== "none" ? "cost" : "group"),
    targetEnabled: Boolean(targetEnabled), ...(parentSubcategoryId ? { parentSubcategoryId } : {}),
    ...(recurringCostId ? { recurringCostId } : {}), sourceLabels: sourceLabels || [],
    ...(expectedAmount !== undefined ? { expectedAmount } : {}),
    ...(intervalMonths !== undefined ? { intervalMonths } : {}),
    ...(dueMonth ? { dueMonth } : {}),
  })),
});

export default function BudgetPlanEditor({ plan, state, ledger, sharedState, month, months, onMonth, onChange, getTrend }) {
  const [mode, setMode] = useState("month");
  const [catalog, setCatalog] = useState(() => cleanCatalog(plan));
  const [allocations, setAllocations] = useState(() => ({ ...plan.allocations }));
  const [bindings, setBindings] = useState(() => resolveBudgetMatchBindings(state, ledger, sharedState));
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newSubcategoryNames, setNewSubcategoryNames] = useState({});
  const [newCostNames, setNewCostNames] = useState({});
  const [linkMonth, setLinkMonth] = useState(month);
  const [showAll, setShowAll] = useState(false);
  const [showReferences, setShowReferences] = useState(false);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const stateKey = JSON.stringify([month, sharedState.budgetCatalogVersions, sharedState.budgetMonthPlans, sharedState.budgetMatchBindings]);
  useEffect(() => {
    setCatalog(cleanCatalog(plan));
    setAllocations({ ...plan.allocations });
    setBindings(resolveBudgetMatchBindings(state, ledger, sharedState));
    setLinkMonth(month);
    if (month < todayMonth()) setMode("month");
  }, [stateKey]);

  const baselineAllowed = month >= todayMonth();
  const isBaseline = mode === "baseline" && baselineAllowed;
  const categories = ordered(catalog.categories);
  const actualByCategory = new Map(plan.categories.map((item) => [item.id, item.actual]));
  const visibleCategories = categories.filter((category) => showAll || (!category.archived && (
    !category.id.startsWith("legacy:")
    || number(allocations[category.id]) > 0
    || number(actualByCategory.get(category.id)) > 0)));
  const total = catalog.categories.reduce((value, item) => value + number(allocations[item.id]), 0);
  const committed = committedTotal(catalog, allocations);
  const reviewedTransactions = (ledger.transactions || []).filter(isBudgetExpense);
  const bindingsFor = (item) => bindings.filter((row) => row.subcategoryId === item.id);
  const matchConflict = (binding) => binding && bindings.some((row) => row !== binding && row.kind === binding.kind &&
    budgetMatchKey(row.sourceCategory) === budgetMatchKey(binding.sourceCategory) && budgetMatchKey(row.sourceKey) === budgetMatchKey(binding.sourceKey));

  function updateCategory(id, change) {
    setCatalog((current) => ({ ...current, categories: current.categories.map((item) => item.id === id ? {
      ...item, ...change,
      sourceNames: change.name !== undefined && change.name !== item.name
        ? (item.sourceNames?.length ? item.sourceNames : [item.name])
        : item.sourceNames,
    } : item) }));
  }
  function updateSubcategory(id, change) {
    setCatalog((current) => ({ ...current, subcategories: current.subcategories.map((item) => item.id === id ? { ...item, ...change } : item) }));
  }
  function setAmount(id, value) {
    const valueAsNumber = Math.max(0, round(value));
    const item = catalog.subcategories.find((row) => row.id === id);
    setAllocations((current) => ({ ...current, [id]: isBaseline && item?.schedule === "one-time" && item.dueMonth !== month ? 0 : valueAsNumber }));
    if (isBaseline) {
      if (item) updateSubcategory(id, { defaultAmount: valueAsNumber });
      else updateCategory(id, { defaultAmount: valueAsNumber });
    }
  }
  function setSchedule(item, schedule) {
    updateSubcategory(item.id, { schedule, ...(schedule === "one-time" && !item.dueMonth ? { dueMonth: month } : {}) });
    if (schedule === "one-time" && item.dueMonth && item.dueMonth !== month) setAllocations((current) => ({ ...current, [item.id]: 0 }));
    if (item.schedule === "one-time" && schedule !== "one-time" && item.dueMonth !== month) {
      setAllocations((current) => ({ ...current, [item.id]: number(item.defaultAmount) }));
    }
  }
  function setDueMonth(item, dueMonth) {
    updateSubcategory(item.id, { dueMonth: dueMonth || undefined });
    if (item.schedule === "one-time") setAllocations((current) => ({ ...current, [item.id]: dueMonth === month ? number(item.defaultAmount) : 0 }));
  }
  function addCategory(event) {
    event.preventDefault();
    const name = newCategoryName.trim();
    if (!name) return;
    if (catalog.categories.some((item) => [item.name, ...(item.sourceNames || [])].some((value) => value.toLocaleLowerCase() === name.toLocaleLowerCase()))) {
      setMessage({ tone: "error", text: "That name already belongs to a category or its import source." }); return;
    }
    const id = crypto.randomUUID();
    setCatalog((current) => ({
      ...current, categories: [...current.categories, { id, name, sourceNames: [name], order: current.categories.length,
        archived: false, commitment: "flexible", defaultAmount: 0 }],
    }));
    setAllocations((current) => ({ ...current, [id]: 0 }));
    setNewCategoryName(""); setMessage(null);
  }
  function addSubcategory(categoryId) {
    const name = (newSubcategoryNames[categoryId] || "").trim();
    if (!name) { setMessage({ tone: "error", text: "Enter a subcategory name first." }); return; }
    const category = catalog.categories.find((row) => row.id === categoryId);
    if (!category) return;
    const id = crypto.randomUUID();
    setCatalog((current) => ({ ...current, subcategories: [...current.subcategories, { id, categoryId,
      name, order: current.subcategories.filter((item) => item.categoryId === categoryId).length,
      archived: false, kind: "group", targetEnabled: false, commitment: "flexible", schedule: "none",
      defaultAmount: 0, sourceLabels: [] }] }));
    const sourceCategory = category.sourceNames?.[0] || category.name;
    const claimed = bindings.some((row) => row.kind === "label" && budgetMatchKey(row.sourceCategory) === budgetMatchKey(sourceCategory)
      && budgetMatchKey(row.sourceKey) === budgetMatchKey(name));
    if (!claimed) setBindings((current) => [...current, { kind: "label", categoryId, subcategoryId: id, sourceCategory, sourceKey: name }]);
    else setMessage({ tone: "error", text: `${sourceCategory} → ${name} is already linked to another subcategory. This one is plan only until you choose another label.` });
    setNewSubcategoryNames((current) => ({ ...current, [categoryId]: "" }));
  }
  function addCost(categoryId) {
    const name = (newCostNames[categoryId] || "").trim();
    if (!name) { setMessage({ tone: "error", text: "Enter a cost name first." }); return; }
    const id = crypto.randomUUID();
    setCatalog((current) => ({ ...current, subcategories: [...current.subcategories, { id, categoryId, name,
      order: current.subcategories.filter((item) => item.categoryId === categoryId).length,
      archived: false, kind: "cost", targetEnabled: false, commitment: "committed", schedule: "monthly",
      defaultAmount: 0, sourceLabels: [] }] }));
    setAllocations((current) => ({ ...current, [id]: 0 }));
    setNewCostNames((current) => ({ ...current, [categoryId]: "" }));
  }
  function updateMatch(item, category, existing, value) {
    const sourceKey = value;
    setBindings((current) => sourceKey
      ? existing
        ? current.map((row) => row === existing ? { ...row, sourceKey } : row)
        : [...current, { kind: "label", categoryId: category.id, subcategoryId: item.id,
          sourceCategory: category.sourceNames?.[0] || category.name, sourceKey }]
      : current.filter((row) => row !== existing));
  }
  function move(categoryId, id, delta) {
    const collection = categoryId ? ordered(catalog.subcategories.filter((item) => item.categoryId === categoryId)) : categories;
    const index = collection.findIndex((item) => item.id === id), neighbor = collection[index + delta];
    if (!neighbor) return;
    if (categoryId) setCatalog((current) => ({ ...current, subcategories: current.subcategories.map((item) =>
      item.id === id ? { ...item, order: neighbor.order } : item.id === neighbor.id ? { ...item, order: collection[index].order } : item) }));
    else setCatalog((current) => ({ ...current, categories: current.categories.map((item) =>
      item.id === id ? { ...item, order: neighbor.order } : item.id === neighbor.id ? { ...item, order: collection[index].order } : item) }));
  }
  function archiveCategory(item) {
    updateCategory(item.id, { archived: !item.archived });
    const children = catalog.subcategories.filter((child) => child.categoryId === item.id);
    setAllocations((current) => ({ ...current, ...Object.fromEntries(children.map((child) => [child.id,
      item.archived && !child.archived && (child.schedule !== "one-time" || child.dueMonth === month) ? number(child.defaultAmount) : 0])),
      [item.id]: item.archived ? number(item.defaultAmount) : 0 }));
  }
  function archiveSubcategory(item) {
    updateSubcategory(item.id, { archived: !item.archived });
    setAllocations((current) => ({ ...current, [item.id]: item.archived && (item.schedule !== "one-time" || item.dueMonth === month) ? number(item.defaultAmount) : 0 }));
  }
  function linkTransaction(item, category, transactionId) {
    const sourceCategory = category.sourceNames?.[0] || category.name;
    setBindings((current) => current.filter((row) => !(row.kind === "transaction" && row.sourceCategory === sourceCategory && row.sourceKey === transactionId))
      .concat(transactionId ? [{ kind: "transaction", categoryId: category.id, subcategoryId: item.id,
        sourceCategory, sourceKey: transactionId }] : []));
  }
  async function save(event) {
    event.preventDefault();
    const names = catalog.categories.map((item) => item.name.trim().toLocaleLowerCase());
    const childNames = catalog.subcategories.map((item) => `${item.categoryId}:${item.name.trim().toLocaleLowerCase()}`);
    if (names.some((name) => !name) || new Set(names).size !== names.length || catalog.subcategories.some((item) => !item.name.trim())
      || new Set(childNames).size !== childNames.length
      || catalog.categories.some((item) => catalog.categories.some((other) => other.id !== item.id && (other.sourceNames || []).some((source) => source.toLocaleLowerCase() === item.name.trim().toLocaleLowerCase())))) {
      setMessage({ tone: "error", text: "Give every category and subcategory a distinct, non-empty name." }); return;
    }
    if (catalog.subcategories.some((item) => item.schedule === "one-time" && !item.dueMonth)) {
      setMessage({ tone: "error", text: "Give every one-time cost a due month." }); return;
    }
    if (bindings.some(matchConflict)) {
      setMessage({ tone: "error", text: "An import label is already linked to another subcategory in the same source category." }); return;
    }
    if (bindings.some((row) => !row.sourceKey.trim())) {
      setMessage({ tone: "error", text: "Give each reviewed import label a non-empty name, or remove its match." }); return;
    }
    for (const category of catalog.categories.filter((row) => !row.archived)) {
      const children = catalog.subcategories.filter((row) => row.categoryId === category.id && !row.archived);
      const groups = children.filter((row) => row.kind === "group" && row.targetEnabled);
      const costs = children.filter((row) => row.kind === "cost");
      const reserved = groups.reduce((total, row) => total + number(allocations[row.id]), 0) +
        costs.filter((row) => !groups.some((group) => group.id === row.parentSubcategoryId))
          .reduce((total, row) => total + number(allocations[row.id]), 0);
      const overfilledGroup = groups.find((group) => costs.filter((row) => row.parentSubcategoryId === group.id)
        .reduce((total, row) => total + number(allocations[row.id]), 0) > number(allocations[group.id]));
      if (overfilledGroup || reserved > number(allocations[category.id])) {
        setMessage({ tone: "error", text: overfilledGroup
          ? `Known costs exceed the ${overfilledGroup.name} target. Raise that target or reduce its costs.`
          : `${category.name} reserves ${money(reserved)} inside a ${money(allocations[category.id])} plan. Raise the category amount or reduce its targets and costs.` });
        return;
      }
    }
    const monthEdits = Object.fromEntries(Object.entries(allocations).filter(([id, value]) =>
      round(value) !== round(plan.baselineAllocations[id])));
    const payload = isBaseline
      ? { effectiveFromMonth: month, catalog, bindings, month, allocations: monthEdits }
      : { month, allocations: monthEdits };
    setBusy(true); setMessage(null);
    try {
      const result = await saveBudgetPlan(payload);
      onChange(result.sharedState);
      setMessage({ tone: "success", text: `${isBaseline ? "Baseline and monthly plan" : "Monthly plan"} saved for ${formatMonth(month)}.` });
    } catch (error) { setMessage({ tone: "error", text: error.message }); }
    finally { setBusy(false); }
  }

  return <section className="panel budget-plan-editor" aria-labelledby="budgetEditorTitle">
    <div className="budget-plan-editor-head"><div><h2 id="budgetEditorTitle">Plan {formatMonth(month)}</h2><p className="soft-copy">Set a total for each category. Add known costs or optional subcategories only when they help. Reviewed matches organize spending; transaction categories are changed in import review.</p></div><label>Month <select aria-label="Budget planning month" value={month} onChange={(event) => { setMessage(null); onMonth(event.target.value); }}>{months.map((value) => <option key={value} value={value}>{formatMonth(value)}</option>)}</select></label></div>
    <div className="budget-plan-mode" role="group" aria-label="Plan editing mode"><button className={!isBaseline ? "active" : ""} type="button" onClick={() => setMode("month")}>This month</button><button className={isBaseline ? "active" : ""} type="button" disabled={!baselineAllowed} onClick={() => setMode("baseline")}>Baseline plan</button></div>
    <p className="budget-plan-mode-note">{isBaseline ? `Baseline changes start in ${formatMonth(month)} and carry into later months until revised.` : month < todayMonth() ? "This closed month keeps its plan when the baseline changes." : "Change this month without changing your baseline or other months."}</p>
    <div className="budget-plan-editor-summary"><span><small>Total planned</small><strong>{money(total)}</strong></span><span><small>Committed</small><strong>{money(committed)}</strong></span><span><small>Flexible</small><strong>{money(total - committed)}</strong></span></div>
    <div className="budget-plan-list-control"><span>{visibleCategories.length} of {categories.length} categories shown</span><div><button className="budget-text-button" type="button" onClick={() => setShowReferences(!showReferences)}>{showReferences ? "Hide recent spending" : "Show recent spending"}</button><button className="budget-text-button" type="button" onClick={() => setShowAll(!showAll)}>{showAll ? "Show active categories" : "Show all categories"}</button></div></div>
    <form onSubmit={save}>
      <div className="budget-plan-editor-list">{visibleCategories.map((category) => {
        const children = ordered(catalog.subcategories.filter((item) => item.categoryId === category.id));
        const categoryTotal = number(allocations[category.id]);
        const groups = children.filter((item) => !item.archived && item.kind === "group" && item.targetEnabled);
        const costs = children.filter((item) => !item.archived && item.kind === "cost");
        const reserved = groups.reduce((value, item) => value + number(allocations[item.id]), 0) +
          costs.filter((item) => !groups.some((group) => group.id === item.parentSubcategoryId))
            .reduce((value, item) => value + number(allocations[item.id]), 0);
        const prior = showReferences ? (getTrend?.(category.name)?.rows || []).filter((row) => row.month < month).slice(-3) : [];
        const average = prior.length ? prior.reduce((value, row) => value + number(row.actual), 0) / prior.length : null;
        const sourceCategory = category.sourceNames?.[0] || category.name;
        const reviewedLabels = new Map();
        for (const tx of reviewedTransactions) {
          if (tx.categoryReviewed !== true || budgetMatchKey(tx.category) !== budgetMatchKey(sourceCategory) || !budgetMatchKey(tx.costLabel)) continue;
          if (bindings.some((row) => row.kind === "recurring" && bindingMatchesTransaction(row, tx))) continue;
          const key = budgetMatchKey(tx.costLabel), current = reviewedLabels.get(key);
          reviewedLabels.set(key, { name: current?.name || String(tx.costLabel).trim(), count: (current?.count || 0) + 1 });
        }
        const labelOptions = [...reviewedLabels.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        return <section className={`budget-plan-edit-category ${category.archived ? "is-archived" : ""}`} key={category.id}>
          <div className="budget-plan-edit-category-head"><div>{isBaseline ? <label><span className="sr-only">Category name</span><input value={category.name} maxLength="100" onChange={(event) => updateCategory(category.id, { name: event.target.value })} /></label> : <h3>{category.name}</h3>}{showReferences && <small>{average === null ? "No earlier spending reference" : `Recent ${prior.length}-month average: ${money(average)} · reference only`}</small>}</div><label className="budget-plan-amount">Monthly total <input type="number" min="0" step="0.01" aria-label={`${category.name} monthly total in shekels`} value={allocations[category.id] ?? 0} onChange={(event) => setAmount(category.id, event.target.value)} /></label>{isBaseline && <label>Other spending <select aria-label={`${category.name} other spending type`} value={category.commitment} onChange={(event) => updateCategory(category.id, { commitment: event.target.value })}><option value="flexible">Flexible</option><option value="committed">Committed</option></select></label>}{isBaseline && <div className="budget-plan-row-actions"><button type="button" onClick={() => move(null, category.id, -1)} aria-label={`Move ${category.name} up`}>↑</button><button type="button" onClick={() => move(null, category.id, 1)} aria-label={`Move ${category.name} down`}>↓</button><button type="button" onClick={() => archiveCategory(category)}>{category.archived ? "Restore" : "Archive"}</button></div>}</div>
          <p className="budget-plan-reserve-note">{reserved > categoryTotal ? `${money(reserved - categoryTotal)} over the category plan` : `${money(categoryTotal - reserved)} for other ${category.name} spending`} · {money(reserved)} reserved for targets and known costs</p>
          {(children.length > 0 || isBaseline) && <details className="budget-plan-edit-breakdown"><summary>{children.length ? `${children.filter((item) => item.kind === "cost").length} known cost${children.filter((item) => item.kind === "cost").length === 1 ? "" : "s"} · ${children.filter((item) => item.kind === "group").length} optional subcategor${children.filter((item) => item.kind === "group").length === 1 ? "y" : "ies"}` : "Add known costs or optional subcategories"}</summary><div className="budget-plan-edit-children">{children.filter((item) => !item.archived || isBaseline || number(allocations[item.id]) > 0 || number(plan.subcategories.find((row) => row.id === item.id)?.actual) > 0).map((item) => {
            const itemBindings = bindingsFor(item);
            const labelBindings = itemBindings.filter((row) => row.kind === "label");
            const manualBindings = itemBindings.filter((row) => row.kind === "transaction");
            const count = itemBindings.reduce((sum, binding) => sum + linkedTransactionCount(binding, bindings, reviewedTransactions), 0);
            const conflict = itemBindings.some(matchConflict);
            const availableLabels = labelOptions.filter((option) => !bindings.some((row) => row.kind === "label" && row.subcategoryId !== item.id &&
              budgetMatchKey(row.sourceCategory) === budgetMatchKey(sourceCategory) && budgetMatchKey(row.sourceKey) === budgetMatchKey(option.name)));
            return <div className={`budget-plan-edit-child ${item.archived ? "is-archived" : ""}`} key={item.id}>
            <div className="budget-plan-child-name"><small>{item.kind === "cost" ? "Known cost" : "Optional subcategory"}</small>{isBaseline ? <label><span className="sr-only">{item.kind === "cost" ? "Known cost" : "Subcategory"} name in {category.name}</span><input value={item.name} maxLength="100" onChange={(event) => updateSubcategory(item.id, { name: event.target.value })} /></label> : <strong>{item.name}</strong>}{item.addedLater && <small>Actual only, added after this month</small>}</div>
            <div className="budget-plan-child-fields">
              {isBaseline ? <>
                {item.kind === "group" && <label className="budget-target-toggle"><input type="checkbox" checked={item.targetEnabled} onChange={(event) => { updateSubcategory(item.id, { targetEnabled: event.target.checked, defaultAmount: event.target.checked ? number(item.defaultAmount) : 0 }); setAllocations((current) => event.target.checked ? { ...current, [item.id]: number(item.defaultAmount) } : Object.fromEntries(Object.entries(current).filter(([id]) => id !== item.id))); }} />Reserve an amount</label>}
                {(item.kind === "cost" || item.targetEnabled) && <label><span className="sr-only">{item.name} commitment type</span><select value={item.commitment} onChange={(event) => updateSubcategory(item.id, { commitment: event.target.value })}><option value="committed">Committed</option><option value="flexible">Flexible</option></select></label>}
                {item.kind === "cost" && <label><span className="sr-only">{item.name} schedule</span><select value={item.schedule} onChange={(event) => setSchedule(item, event.target.value)}><option value="none">No schedule</option><option value="monthly">Monthly</option><option value="periodic">Periodic</option><option value="one-time">One-time</option></select></label>}
                {item.kind === "cost" && <label>Subcategory <select aria-label={`${item.name} subcategory`} value={item.parentSubcategoryId || ""} onChange={(event) => updateSubcategory(item.id, { parentSubcategoryId: event.target.value || undefined })}><option value="">None</option>{children.filter((child) => child.kind === "group" && !child.archived).map((child) => <option key={child.id} value={child.id}>{child.name}</option>)}</select></label>}
              </> : <span className="budget-plan-type-chip">{item.kind === "group" && !item.targetEnabled ? "Group only" : `${item.commitment} · ${item.schedule === "none" ? "no schedule" : item.schedule}`}</span>}
              {(item.kind === "cost" || item.targetEnabled) && <label className="budget-plan-amount"><span className="sr-only">{item.name} {isBaseline && item.schedule === "one-time" ? "one-time baseline amount" : "monthly reserved amount"} in shekels</span><input type="number" min="0" step="0.01" disabled={item.addedLater} value={isBaseline && item.schedule === "one-time" ? item.defaultAmount : allocations[item.id] ?? 0} onChange={(event) => setAmount(item.id, event.target.value)} /></label>}
            </div>
            <div className="budget-plan-match">
              {isBaseline && !item.recurringCostId && (labelBindings.length ? labelBindings : [null]).map((binding, index) => <div className="budget-plan-match-row" key={index}>
                <label>Reviewed import label <input value={binding?.sourceKey || ""} maxLength="100" aria-label={`${item.name} reviewed import label ${index + 1} in ${category.name}`} aria-invalid={matchConflict(binding) || undefined} onChange={(event) => updateMatch(item, category, binding, event.target.value)} placeholder="Exact reviewed label" /></label>
                {binding && <button type="button" className="budget-text-button" aria-label={`Remove ${binding.sourceKey} match from ${item.name}`} onClick={() => updateMatch(item, category, binding, "")}>Remove match</button>}
              </div>)}
              <span className={conflict ? "budget-match-conflict" : ""}>{conflict ? "This match is already linked within the source category." : count > 0 ? `${count} reviewed transaction${count === 1 ? "" : "s"} linked` : "Plan only — no reviewed transaction match yet"}</span>
              {isBaseline && !item.recurringCostId && availableLabels.length > 0 && <label className="budget-plan-label-picker">Choose an existing reviewed label<select aria-label={`Choose reviewed import label for ${item.name} in ${category.name}`} value="" onChange={(event) => { if (event.target.value) updateMatch(item, category, labelBindings[0], event.target.value); }}><option value="">Select label</option>{availableLabels.map((option) => <option key={option.name} value={option.name}>{option.name} · {option.count} transaction{option.count === 1 ? "" : "s"}</option>)}</select></label>}
              {isBaseline && !item.recurringCostId && <><label>Payment month <input type="month" value={linkMonth} onChange={(event) => setLinkMonth(event.target.value)} /></label><label>Link one reviewed transaction <select aria-label={`Link reviewed transaction to ${item.name}`} value="" onChange={(event) => { if (event.target.value) linkTransaction(item, category, event.target.value); }}><option value="">Select transaction</option>{reviewedTransactions.filter((tx) => tx.categoryReviewed === true && budgetMatchKey(tx.category) === budgetMatchKey(sourceCategory) && String(tx.date || "").startsWith(linkMonth) && tx.id && !bindings.some((row) => row.kind === "recurring" && bindingMatchesTransaction(row, tx))).sort((a, b) => String(b.date).localeCompare(String(a.date))).map((tx) => <option key={tx.id} value={tx.id}>{tx.date} · {tx.merchant || tx.description || tx.costLabel || tx.id} · {money(tx.amount)}</option>)}</select></label></>}
              {isBaseline && manualBindings.map((binding) => <div key={binding.sourceKey} className="budget-plan-match-row"><span>Linked transaction {binding.sourceKey}</span><button type="button" className="budget-text-button" onClick={() => setBindings((current) => current.filter((row) => row !== binding))}>Remove link</button></div>)}
              {!count && !item.recurringCostId && <a href={`#activity?month=${month}&category=${encodeURIComponent(sourceCategory)}`}>Review imported transactions</a>}
            </div>
            {isBaseline && (item.schedule === "periodic" || item.schedule === "one-time") && <div className="budget-plan-schedule-fields"><label>Expected cost <input type="number" min="0" step="0.01" value={item.expectedAmount ?? ""} onChange={(event) => updateSubcategory(item.id, { expectedAmount: event.target.value === "" ? undefined : round(event.target.value) })} /></label>{item.schedule === "periodic" && <label>Every <select value={item.intervalMonths || 12} onChange={(event) => updateSubcategory(item.id, { intervalMonths: Number(event.target.value) })}><option value="3">3 months</option><option value="6">6 months</option><option value="12">12 months</option></select></label>}<label>Due month <input type="month" value={item.dueMonth || ""} onChange={(event) => setDueMonth(item, event.target.value)} /></label>{item.schedule === "periodic" && number(item.expectedAmount) > 0 && <button type="button" className="budget-text-button" onClick={() => setAmount(item.id, round(item.expectedAmount / (item.intervalMonths || 12)))}>Use {money(item.expectedAmount / (item.intervalMonths || 12))} monthly reserve</button>}</div>}
            {isBaseline && <div className="budget-plan-row-actions"><button type="button" onClick={() => move(category.id, item.id, -1)} aria-label={`Move ${item.name} up`}>↑</button><button type="button" onClick={() => move(category.id, item.id, 1)} aria-label={`Move ${item.name} down`}>↓</button><button type="button" onClick={() => archiveSubcategory(item)}>{item.archived ? "Restore" : "Archive"}</button></div>}
          </div>; })}</div>
          {isBaseline && !category.archived && <div className="budget-plan-add-child"><label>Optional subcategory in {category.name}<input value={newSubcategoryNames[category.id] || ""} maxLength="100" onChange={(event) => setNewSubcategoryNames((current) => ({ ...current, [category.id]: event.target.value }))} placeholder="For example, Parking" /></label><button className="budget-text-button" type="button" aria-label={`Add subcategory to ${category.name}`} onClick={() => addSubcategory(category.id)}>Add subcategory</button></div>}
          {isBaseline && !category.archived && <div className="budget-plan-add-child"><label>Known cost in {category.name}<input value={newCostNames[category.id] || ""} maxLength="100" onChange={(event) => setNewCostNames((current) => ({ ...current, [category.id]: event.target.value }))} placeholder="For example, annual insurance" /></label><button className="budget-text-button" type="button" aria-label={`Add known cost to ${category.name}`} onClick={() => addCost(category.id)}>Add known cost</button></div>}
          </details>}
        </section>;
      })}</div>
      {isBaseline && <div className="budget-plan-add-category"><label>New category <input value={newCategoryName} maxLength="100" onChange={(event) => setNewCategoryName(event.target.value)} placeholder="For example, Pets" /></label><button className="secondary-btn" type="button" onClick={addCategory}>Add category</button></div>}
      <div className="budget-plan-editor-footer"><p className={`save-state ${message?.tone || ""}`} role="status">{message?.text || "Plans are shared with your household. Archived items remain in older months."}</p><button className="primary-btn" type="submit" disabled={busy}>{busy ? "Saving…" : isBaseline ? "Save baseline and this month" : "Save this month"}</button></div>
    </form>
  </section>;
}
