import test from "node:test";
import assert from "node:assert/strict";
import { resolveBudgetBasis } from "./routing.js";

test("Budget defaults to monthly installments while honoring explicit cost modes", () => {
  assert.equal(resolveBudgetBasis("budget", null), "installments");
  assert.equal(resolveBudgetBasis("budget", "unsupported"), "installments");
  assert.equal(resolveBudgetBasis("budget", "purchase"), "purchase");
  assert.equal(resolveBudgetBasis("budget", "installments"), "installments");
});

test("non-Budget routes keep purchase as their budget-data default", () => {
  assert.equal(resolveBudgetBasis("activity", null), "purchase");
  assert.equal(resolveBudgetBasis("activity", "billing"), "purchase");
  assert.equal(resolveBudgetBasis("activity", "installments"), "installments");
  assert.equal(resolveBudgetBasis("today", null), "purchase");
});
