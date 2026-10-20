import { getDb } from "../../../../db";
import { requireApiUser } from "../../../server/access";
import { baseCurrency, cleanText, finiteMoney, parseRequestJson, readSharedState, validDate, validMonth, type CashCurrency } from "../../../server/shared-state";
import { validateBindings, validateCatalog } from "../budget-plan/route";

export async function GET() {
  const access = await requireApiUser();
  if (access instanceof Response) return access;
  return Response.json({
    schemaVersion: "cashflow-repair-shared-state/v5",
    exportedAt: new Date().toISOString(),
    product: "Cashflow Repair",
    sharedState: await readSharedState(),
  });
}

export async function POST(request: Request) {
  const access = await requireApiUser();
  if (access instanceof Response) return access;
  const body = await parseRequestJson(request);
  if (body instanceof Response) return body;
  const candidate = (body.sharedState || body.appMemory || body) as Record<string, unknown>;
  const settingsSource = (candidate.settings || {}) as Record<string, unknown>;
  const legacyState = body.state && typeof body.state === "object" ? body.state as Record<string, unknown> : {};
  const householdCurrency = await baseCurrency();
  const rawCurrency = settingsSource.currency ?? legacyState.currency;
  const currency = rawCurrency == null ? null : cleanText(rawCurrency, 3);
  if (rawCurrency != null && currency !== householdCurrency) return Response.json({ error: "Backup currency is unsupported." }, { status: 400 });
  const rawOpeningBalance = settingsSource.openingBalance ?? legacyState.openingBalance;
  const openingBalance = rawOpeningBalance == null ? null : finiteMoney(rawOpeningBalance, -1_000_000_000);
  if (rawOpeningBalance != null && openingBalance === null) return Response.json({ error: "Backup contains an invalid opening balance." }, { status: 400 });
  const rawBufferTarget = settingsSource.bufferTarget ?? legacyState.bufferTarget;
  const bufferTarget = rawBufferTarget == null ? null : finiteMoney(rawBufferTarget);
  if (rawBufferTarget != null && bufferTarget === null) return Response.json({ error: "Backup contains an invalid comfort buffer." }, { status: 400 });
  const budgetSource = (candidate.budgetOverridesByMonth || {}) as Record<string, unknown>;
  const budgets: Array<[string, string, number]> = [];
  for (const [month, rawMonthValues] of Object.entries(budgetSource)) {
    if (!validMonth(month) || !rawMonthValues || typeof rawMonthValues !== "object" || Array.isArray(rawMonthValues)) {
      return Response.json({ error: "Backup contains an invalid budget month." }, { status: 400 });
    }
    for (const [rawCategory, rawAmount] of Object.entries(rawMonthValues as Record<string, unknown>)) {
      const category = cleanText(rawCategory, 100);
      const amount = finiteMoney(rawAmount);
      if (!category || amount === null) return Response.json({ error: "Backup contains an invalid budget override." }, { status: 400 });
      budgets.push([month, category, amount]);
    }
  }
  const recurringSource = (candidate.recurringOverridesByMonth || {}) as Record<string, unknown>;
  const recurringOverrides: Array<[string, string, number, boolean]> = [];
  for (const [month, rawMonthValues] of Object.entries(recurringSource)) {
    if (!validMonth(month) || !rawMonthValues || typeof rawMonthValues !== "object" || Array.isArray(rawMonthValues)) {
      return Response.json({ error: "Backup contains an invalid recurring-plan month." }, { status: 400 });
    }
    for (const [rawId, rawValue] of Object.entries(rawMonthValues as Record<string, unknown>)) {
      const id = cleanText(rawId, 120);
      if (!id || !rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
        return Response.json({ error: "Backup contains an invalid recurring-plan override." }, { status: 400 });
      }
      const row = rawValue as Record<string, unknown>;
      const amount = finiteMoney(row.amount);
      if (amount === null || typeof row.included !== "boolean") {
        return Response.json({ error: "Backup contains an invalid recurring-plan amount or inclusion choice." }, { status: 400 });
      }
      recurringOverrides.push([month, id, amount, row.included]);
    }
  }
  const categorySource = (candidate.categorySettings || {}) as Record<string, unknown>;
  const categorySettings: Array<[string, "committed" | "flexible"]> = [];
  for (const [rawCategory, rawValue] of Object.entries(categorySource)) {
    const category = cleanText(rawCategory, 100);
    const spendingType = rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
      ? (rawValue as Record<string, unknown>).spendingType
      : rawValue;
    if (!category || !["committed", "flexible"].includes(String(spendingType))) {
      return Response.json({ error: "Backup contains an invalid category setting." }, { status: 400 });
    }
    categorySettings.push([category, spendingType as "committed" | "flexible"]);
  }
  const catalogSource = candidate.budgetCatalogVersions || [];
  if (!Array.isArray(catalogSource) || catalogSource.length > 120) return Response.json({ error: "Backup contains invalid budget catalog history." }, { status: 400 });
  const catalogVersions: Array<[string, string]> = [];
  const seenCatalogMonths = new Set<string>();
  for (const raw of catalogSource) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return Response.json({ error: "Backup contains an invalid budget catalog." }, { status: 400 });
    const row = raw as Record<string, unknown>;
    const month = row.effectiveFromMonth, catalog = validateCatalog(row.catalog);
    if (!validMonth(month) || !catalog || seenCatalogMonths.has(month)) return Response.json({ error: "Backup contains an invalid budget catalog." }, { status: 400 });
    seenCatalogMonths.add(month);
    catalogVersions.push([month, JSON.stringify(catalog)]);
  }
  const newestCatalog = [...catalogVersions].sort((a, b) => a[0].localeCompare(b[0])).at(-1);
  const matchBindings = candidate.budgetMatchBindings === undefined || candidate.budgetMatchBindings === null
    ? null : validateBindings(candidate.budgetMatchBindings, newestCatalog ? JSON.parse(newestCatalog[1]) : null);
  if (candidate.budgetMatchBindings !== undefined && candidate.budgetMatchBindings !== null &&
    (!matchBindings || (matchBindings.length > 0 && !newestCatalog))) {
    return Response.json({ error: "Backup contains invalid budget transaction matches." }, { status: 400 });
  }
  const monthPlanSource = (candidate.budgetMonthPlans || {}) as Record<string, unknown>;
  if (!monthPlanSource || typeof monthPlanSource !== "object" || Array.isArray(monthPlanSource) || Object.keys(monthPlanSource).length > 240) {
    return Response.json({ error: "Backup contains invalid monthly plans." }, { status: 400 });
  }
  const monthPlans: Array<[string, string]> = [];
  for (const [month, rawAllocations] of Object.entries(monthPlanSource)) {
    if (!validMonth(month) || !rawAllocations || typeof rawAllocations !== "object" || Array.isArray(rawAllocations)) {
      return Response.json({ error: "Backup contains an invalid monthly plan." }, { status: 400 });
    }
    const allocations: Record<string, number> = {};
    const entries = Object.entries(rawAllocations as Record<string, unknown>);
    if (entries.length > 600) return Response.json({ error: "Backup contains too many budget amounts." }, { status: 400 });
    for (const [rawId, rawAmount] of entries) {
      const id = cleanText(rawId, 120), value = finiteMoney(rawAmount);
      if (!id || value === null) return Response.json({ error: "Backup contains an invalid subcategory amount." }, { status: 400 });
      allocations[id] = value;
    }
    monthPlans.push([month, JSON.stringify(allocations)]);
  }
  const entriesSource = candidate.travelCashEntries;
  const entries = Array.isArray(entriesSource) ? entriesSource : [];
  if (budgets.length > 1200 || recurringOverrides.length > 2400 || categorySettings.length > 100 || entries.length > 2000) return Response.json({ error: "Backup is too large." }, { status: 400 });
  const cash: Array<Record<string, string | number>> = [];
  for (const raw of entries) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return Response.json({ error: "Backup contains an invalid cash report." }, { status: 400 });
    const row = raw as Record<string, unknown>;
    const id = cleanText(row.id, 120);
    const type = row.type === "saved" ? "saved" : row.type === "spent" ? "spent" : null;
    const category = cleanText(row.category, 100);
    const currencyKey = cleanText(row.currency, 3) as CashCurrency | null;
    const amount = finiteMoney(row.amount, 0.01);
    const date = row.date;
    const note = typeof row.note === "string" && row.note.trim().length <= 80 ? row.note.trim() : null;
    if (!id || !type || !category || !currencyKey || currencyKey !== householdCurrency || amount === null || !validDate(date) || note === null) {
      return Response.json({ error: "Backup contains an invalid cash report." }, { status: 400 });
    }
    const rate = { rateToNis: 1, rateLabel: `1 ${currencyKey} = 1 ${currencyKey}` };
    cash.push({ id, type, category, currency: currencyKey, amount, date, note, rateToNis: rate.rateToNis, rateLabel: rate.rateLabel });
  }
  const db = getDb();
  const statements = [
    db.prepare("DELETE FROM budget_overrides"),
    db.prepare("DELETE FROM recurring_plan_overrides"),
    db.prepare("DELETE FROM category_settings"),
    db.prepare("DELETE FROM budget_catalog_versions"),
    db.prepare("DELETE FROM budget_month_plans"),
    db.prepare("DELETE FROM budget_match_bindings"),
    db.prepare("DELETE FROM cash_reports"),
    db.prepare(`
      INSERT INTO household_settings (id, currency, opening_balance_cents, buffer_target_cents, updated_by, updated_at)
      VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET currency = excluded.currency, opening_balance_cents = excluded.opening_balance_cents,
        buffer_target_cents = excluded.buffer_target_cents,
        updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP
    `).bind(currency, openingBalance === null ? null : Math.round(openingBalance * 100), bufferTarget === null ? null : Math.round(bufferTarget * 100), access.user.userId),
  ];
  for (const [month, category, amount] of budgets) {
    statements.push(db.prepare("INSERT INTO budget_overrides (month, category, amount_cents, updated_by) VALUES (?, ?, ?, ?)")
      .bind(month, category, Math.round(amount * 100), access.user.userId));
  }
  for (const [month, id, amount, included] of recurringOverrides) {
    statements.push(db.prepare("INSERT INTO recurring_plan_overrides (month, recurring_cost_id, amount_cents, included, updated_by) VALUES (?, ?, ?, ?, ?)")
      .bind(month, id, Math.round(amount * 100), included ? 1 : 0, access.user.userId));
  }
  for (const [category, spendingType] of categorySettings) {
    statements.push(db.prepare("INSERT INTO category_settings (category, spending_type, updated_by) VALUES (?, ?, ?)")
      .bind(category, spendingType, access.user.userId));
  }
  for (const [month, catalogJson] of catalogVersions) {
    statements.push(db.prepare("INSERT INTO budget_catalog_versions (effective_from_month, catalog_json, updated_by) VALUES (?, ?, ?)")
      .bind(month, catalogJson, access.user.userId));
  }
  for (const [month, allocationsJson] of monthPlans) {
    statements.push(db.prepare("INSERT INTO budget_month_plans (month, allocations_json, updated_by) VALUES (?, ?, ?)")
      .bind(month, allocationsJson, access.user.userId));
  }
  if (matchBindings) statements.push(db.prepare("INSERT INTO budget_match_bindings (id, bindings_json, updated_by) VALUES (1, ?, ?)")
    .bind(JSON.stringify(matchBindings), access.user.userId));
  for (const row of cash) {
    statements.push(db.prepare(`
      INSERT INTO cash_reports (id, type, category, currency, amount_minor, rate_to_nis, nis_value_cents, rate_label, report_date, note, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(row.id, row.type, row.category, row.currency, Math.round(Number(row.amount) * 100), row.rateToNis,
      Math.round(Number(row.amount) * Number(row.rateToNis) * 100), row.rateLabel, row.date, row.note, access.user.userId));
  }
  await db.batch(statements);
  return Response.json({ sharedState: await readSharedState() });
}
