import { applySharedState, buildScreenData } from "./finance.js";

export function localCalendarDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function previewAllowance(state, ledger, sharedState, month, draft, today = localCalendarDate()) {
  const previewState = {
    ...sharedState,
    settings: { ...sharedState.settings, bufferTarget: Number(draft.bufferTarget) },
    budgetMonthPlans: { ...sharedState.budgetMonthPlans, [month]: { ...draft.allocations } }
  };
  const model = applySharedState(state, ledger, previewState, month);
  return buildScreenData(model.state, model.ledger, month, today, "purchase", previewState);
}

export function categoryReservations(category) {
  const children = category.subcategories.filter(row => !row.archived && !row.addedLater);
  const groups = children.filter(row => row.kind === "group" && row.targetEnabled);
  const costs = children.filter(row => row.kind === "cost");
  return Math.round((groups.reduce((total, row) => total + row.planned, 0) + costs
    .filter(row => !groups.some(group => group.id === row.parentSubcategoryId))
    .reduce((total, row) => total + row.planned, 0)) * 100) / 100;
}

export function validateAllowanceDraft(plan, draft) {
  if (draft.bufferTarget === "" || !Number.isFinite(Number(draft.bufferTarget)) || Number(draft.bufferTarget) < 0 || Number(draft.bufferTarget) > 1_000_000_000) {
    return "Enter a valid non-negative comfort buffer.";
  }
  for (const category of plan.categories.filter(row => !row.archived && !row.addedLater)) {
    const value = draft.allocations[category.id];
    if (value === "" || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 1_000_000_000) return `Enter a valid non-negative amount for ${category.name}.`;
    const reserved = categoryReservations(category);
    if (Number(value) < reserved) return `${category.name} needs at least ${reserved.toLocaleString()} to cover its existing costs and groups. Edit those costs in Settings → Budgets to reduce this amount.`;
  }
  return null;
}
