import test from "node:test";
import assert from "node:assert/strict";
import { BACKUP_VERSION, backupState } from "./backup.js";

const exported = () => ({ schemaVersion: BACKUP_VERSION, sharedState: {
  settings: { currency: null, openingBalance: null, bufferTarget: null },
  budgetOverridesByMonth: {}, recurringOverridesByMonth: {}, categorySettings: {},
  budgetCatalogVersions: [], budgetMonthPlans: {}, budgetMatchBindings: null, travelCashEntries: [],
} });

test("a complete empty export is valid, including nullable defaults", () => {
  const backup = exported();
  assert.equal(backupState(backup), backup.sharedState);
});

test("unrelated JSON, unsupported versions and partial backups cannot trigger replacement", () => {
  for (const value of [{}, [], null, { schemaVersion: 2, transactions: [] },
    { ...exported(), schemaVersion: "unknown" }, { schemaVersion: BACKUP_VERSION, sharedState: {} }]) {
    assert.equal(backupState(value), null);
  }
  for (const key of Object.keys(exported().sharedState)) {
    const backup = exported();
    delete backup.sharedState[key];
    assert.equal(backupState(backup), null, key);
  }
});

test("malformed containers cannot be silently interpreted as empty data", () => {
  for (const [key, value] of [["settings", []], ["budgetOverridesByMonth", []],
    ["recurringOverridesByMonth", ""], ["categorySettings", null], ["budgetMonthPlans", 0],
    ["budgetCatalogVersions", {}], ["budgetMatchBindings", {}], ["travelCashEntries", {}]]) {
    const backup = exported();
    backup.sharedState[key] = value;
    assert.equal(backupState(backup), null, key);
  }
  const backup = exported();
  delete backup.sharedState.settings.bufferTarget;
  assert.equal(backupState(backup), null);
});
