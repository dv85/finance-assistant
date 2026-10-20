import assert from "node:assert/strict";
import test from "node:test";
import { previewAllowance, validateAllowanceDraft, categoryReservations, localCalendarDate } from "./allowance.js";
import { applySharedState, buildScreenData } from "./finance.js";

const state = { month: "2026-10", bufferTarget: 2000, accountBalance: { date: "2026-10-08", amount: 8000 }, income: [{ source: "Salary", date: "2026-10-27", amount: 2000, expected: true }], categories: [{ name: "Rent", budget: 5000, spendingType: "committed" }, { name: "Dining", budget: 5000, spendingType: "flexible" }] };
const ledger = { transactions: [{ id: "dining", category: "Dining", amount: 3000, date: "2026-10-05", direction: "outflow", type: "expense" }] };
const base = buildScreenData(state, ledger, "2026-10", "2026-10-08");

test("allowance preview uses the same saved-data calculation without mutating inputs", () => {
  const shared = { settings: { bufferTarget: 2000 }, budgetMonthPlans: {} };
  const before = structuredClone({ state, ledger, shared });
  const diningId = base.budgetPlan.categories.find(row => row.name === "Dining").id;
  const draft = { allocations: { ...base.budgetPlan.allocations, [diningId]: 6000 }, bufferTarget: 3000 };
  const preview = previewAllowance(state, ledger, shared, "2026-10", draft, "2026-10-08");
  const savedShared = { ...shared, settings: { bufferTarget: 3000 }, budgetMonthPlans: { "2026-10": draft.allocations } };
  const model = applySharedState(state, ledger, savedShared, "2026-10");
  const afterSave = buildScreenData(model.state, model.ledger, "2026-10", "2026-10-08", "purchase", savedShared);
  assert.deepEqual(preview.summary, afterSave.summary);
  assert.deepEqual({ state, ledger, shared }, before);
  assert.equal(preview.summary.safeSpendPool, 2000);
  assert.equal(preview.summary.safeDailySpend, 2000 / 24);
  assert.equal(preview.summary.totalCashBudgetRemaining, 8000);
  assert.equal(preview.summary.balanceAsOf, "2026-10-08");
  assert.equal(preview.summary.upcomingIncomeRows[0].amount, 2000);
});

test("setup preserves group reservations without counting nested costs twice", () => {
  const category = { id: "c", name: "Home", subcategories: [{ id: "g", kind: "group", targetEnabled: true, planned: 100 }, { id: "inside", kind: "cost", parentSubcategoryId: "g", planned: 40 }, { id: "outside", kind: "cost", planned: 30 }, { id: "archived", kind: "cost", archived: true, planned: 90 }] };
  const plan = { categories: [category] };
  assert.equal(categoryReservations(category), 130);
  assert.match(validateAllowanceDraft(plan, { allocations: { c: 129 }, bufferTarget: 0 }), /at least 130/);
  assert.equal(validateAllowanceDraft(plan, { allocations: { c: 130 }, bufferTarget: 0 }), null);
  assert.match(validateAllowanceDraft(plan, { allocations: { c: "" }, bufferTarget: 0 }), /valid non-negative amount/);
  assert.match(validateAllowanceDraft(plan, { allocations: { c: 130 }, bufferTarget: -1 }), /comfort buffer/);
});

test("preview covers exhausted budgets, stale balance and historical months", () => {
  const diningId = base.budgetPlan.categories.find(row => row.name === "Dining").id;
  const draft = { allocations: { ...base.budgetPlan.allocations, [diningId]: 2500 }, bufferTarget: 2000 };
  const exhausted = previewAllowance(state, ledger, {}, "2026-10", draft, "2026-10-08");
  assert.equal(exhausted.summary.safeSpendPool, 0);
  assert.equal(exhausted.summary.budgetPool, -500);
  assert.equal(exhausted.summary.totalCashBudgetRemaining, 4500);
  const stale = previewAllowance(state, ledger, {}, "2026-10", draft, "2026-10-12");
  assert.equal(stale.summary.guardrailReason, "stale_balance");
  const closed = previewAllowance(state, ledger, {}, "2026-09", draft, "2026-10-08");
  assert.equal(closed.summary.remainingDays, 0);
  assert.equal(closed.summary.safeDailySpend, 0);
  assert.equal(localCalendarDate(new Date(2026, 9, 8, 0, 15)), "2026-10-08");
});
