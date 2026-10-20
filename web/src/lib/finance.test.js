import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applySharedState, billingEvents, budgetEvents, buildScreenData, buildBudgetTrendData, isBudgetExpense, merchantDescription, money, normalizedMerchantName, setDisplayCurrency, transactionMonthDate } from "./finance.js";
import { buildMerchantReport, merchantKey, summarizeMerchantRows } from "./merchantReports.js";

const fixture = JSON.parse(readFileSync(new URL("../../../harness/data/sample-ledger.json", import.meta.url), "utf8"));
const state = {
  currency: "USD", month: "2025-04", openingBalance: 1000, bufferTarget: 200,
  accountBalance: { date: "2025-04-15", amount: 1500 }, income: [], incomeHistory: [],
  categories: [{ name: "Groceries", budget: 200 }, { name: "Dining", budget: 100 }, { name: "Shopping", budget: 100 }],
};

test("reporting dates preserve purchase dates except for explicit installments", () => {
  const cases = JSON.parse(readFileSync(new URL("../../../harness/data/reporting-date-cases.json", import.meta.url), "utf8"));
  for (const item of cases) assert.equal(transactionMonthDate(item.row), item.expectedDate, item.name);
});
test("merchant names and descriptions use user-reviewed fields without a private alias catalog", () => {
  assert.equal(normalizedMerchantName({ normalizedMerchantName: "Example Market", description: "RAW CODE" }), "Example Market");
  assert.equal(normalizedMerchantName({ description: "Example Cafe (9999)" }), "Example Cafe");
  assert.match(merchantDescription({ description: "Example Cafe", category: "Dining" }), /Restaurant/);
});
test("the configured base currency controls money formatting", () => {
  setDisplayCurrency("USD"); assert.match(money(25), /\$/);
  setDisplayCurrency("EUR"); assert.match(money(25), /€/);
  setDisplayCurrency("USD"); assert.throws(() => setDisplayCurrency("bad"));
});
test("transfers and card settlements never increase spending", () => {
  assert.equal(isBudgetExpense({ type: "transfer", amount: 100 }), false);
  assert.equal(isBudgetExpense({ type: "card_settlement", amount: 100 }), false);
  const result = buildScreenData(state, fixture, "2025-04", "2025-04-15", "purchase");
  assert.ok(result.budgetTotal.actual > 0);
  assert.ok(result.budgetTotal.actual < 1000);
});
test("refunds reduce merchant spending and reconcile across all reporting bases", () => {
  const seed = fixture.transactions.find(row => row.normalizedMerchantName === "Example Market");
  for (const basis of ["purchase", "installments", "billing"]) {
    const report = buildMerchantReport(fixture, merchantKey(seed), { month: "2025-04", basis, today: "2025-04-15" });
    const events = basis === "billing" ? billingEvents(fixture) : budgetEvents(fixture, basis);
    const matching = events.filter(row => normalizedMerchantName(row) === "Example Market" && (isBudgetExpense(row) || row.type === "refund"));
    assert.deepEqual(report.allTime, summarizeMerchantRows(matching));
    assert.equal(report.allTime.refunds, 5);
  }
});
test("purchase, installment and billing views preserve their distinct timing", () => {
  const purchase = budgetEvents(fixture, "purchase").filter(row => row.isInstallment);
  assert.equal(purchase.length, 1);
  assert.equal(purchase[0].amount, 60);
  const installments = budgetEvents(fixture, "installments").filter(row => row.isInstallment);
  assert.equal(installments.reduce((sum, row) => sum + row.amount, 0), 60);
  assert.equal(billingEvents(fixture).filter(row => row.isInstallment).length, 2);
});
test("shared edits preserve imported ledger data", () => {
  const before = JSON.stringify(fixture);
  const result = applySharedState(state, fixture, { settings: { bufferTarget: 300 }, budgetOverridesByMonth: { "2025-04": { Groceries: 250 } } }, "2025-04");
  assert.equal(result.state.bufferTarget, 300);
  assert.equal(result.state.categories.find(row => row.name === "Groceries").budget, 250);
  assert.equal(JSON.stringify(fixture), before);
});
test("weekly, daily, merchant and monthly totals reconcile", () => {
  const result = buildScreenData(state, fixture, "2025-04", "2025-04-15", "installments");
  assert.equal(Math.round(result.weeklyReport.weeks.reduce((sum, row) => sum + row.totalRaw, 0) * 100), Math.round(result.budgetTotal.actual * 100));
  assert.ok(Number.isFinite(result.summary.safeDailySpend));
  const trend = buildBudgetTrendData(state, fixture, {}, "2025-04");
  assert.equal(trend.rows.length, 1);
  assert.equal(trend.rows[0].month, "2025-04");
});

const derivedState = JSON.parse(readFileSync(new URL("../../../harness/data/sample-state.json", import.meta.url), "utf8"));
test("imported income history and ledger rows do not double-count received income", () => {
  const screen = buildScreenData(derivedState, fixture, "2025-04", "2025-04-15", "purchase");
  assert.equal(screen.incomeReport.total, 4000);
  assert.equal(screen.incomeReport.rows.length, 1);
});
test("refunds reduce category spending in every financial view", () => {
  const purchase = buildScreenData(state, fixture, "2025-04", "2025-04-15", "purchase");
  const installments = buildScreenData(state, fixture, "2025-04", "2025-04-15", "installments");
  assert.equal(purchase.budgetTotal.actual, 80);
  assert.equal(installments.budgetTotal.actual, 50);
  assert.equal(purchase.budgetRows.find(row => row.category === "Groceries").actual, 20);
});

test("a missing historical closing balance is distinguished from an observed zero", () => {
  const missing = buildScreenData(state, fixture, "2025-04", "2025-05-15", "purchase");
  const observed = buildScreenData({ ...state, monthlyStatus: [{ month: "2025-04", closingBalance: 0 }] }, fixture, "2025-04", "2025-05-15", "purchase");
  assert.equal(missing.summary.hasClosingBalance, false);
  assert.equal(observed.summary.hasClosingBalance, true);
});
