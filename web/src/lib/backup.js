export const BACKUP_VERSION = "cashflow-repair-shared-state/v5";

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);

/** Restore replaces all dashboard edits; only a complete supported export qualifies. */
export function backupState(body) {
  if (!record(body) || body.schemaVersion !== BACKUP_VERSION || !record(body.sharedState)) return null;
  const state = body.sharedState;
  if (!record(state.settings) || !["currency", "openingBalance", "bufferTarget"].every(key => Object.hasOwn(state.settings, key))) return null;
  if (!["budgetOverridesByMonth", "recurringOverridesByMonth", "categorySettings", "budgetMonthPlans"].every(key => record(state[key]))) return null;
  if (!Array.isArray(state.budgetCatalogVersions) || !Array.isArray(state.travelCashEntries)) return null;
  if (!Object.hasOwn(state, "budgetMatchBindings") || state.budgetMatchBindings !== null && !Array.isArray(state.budgetMatchBindings)) return null;
  return state;
}
