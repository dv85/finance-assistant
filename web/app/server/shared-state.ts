import { getDb, parseJson } from "../../db";

export type CashCurrency = string;
export async function baseCurrency(): Promise<string> {
  const row = await getDb().prepare(`SELECT state.state_json FROM app_config config
    JOIN snapshot_state state ON state.snapshot_id = config.active_snapshot_id WHERE config.id = 1`).first<{ state_json: string }>();
  return parseJson<{ currency?: string }>(row?.state_json, {}).currency ?? "USD";
}

export type SharedState = {
  settings: { currency: string | null; openingBalance: number | null; bufferTarget: number | null; updatedAt: string | null };
  budgetOverridesByMonth: Record<string, Record<string, number>>;
  recurringOverridesByMonth: Record<string, Record<string, { amount: number; included: boolean }>>;
  categorySettings: Record<string, { spendingType: "committed" | "flexible"; updatedAt: string | null }>;
  budgetCatalogVersions: Array<{ effectiveFromMonth: string; catalog: BudgetCatalog }>;
  budgetMonthPlans: Record<string, Record<string, number>>;
  budgetMatchBindings: BudgetMatchBinding[] | null;
  travelCashEntries: Array<{
    id: string;
    type: "spent" | "saved";
    category: string;
    currency: CashCurrency;
    amount: number;
    nisValue: number;
    rateToNis: number;
    rateLabel: string;
    date: string;
    note: string;
    createdAt: string;
  }>;
};

export type BudgetMatchBinding = {
  kind: "label" | "recurring" | "transaction";
  categoryId: string;
  subcategoryId: string;
  sourceCategory: string;
  sourceKey: string;
};

export type BudgetCatalog = {
  schemaVersion?: 2;
  categories: Array<{ id: string; name: string; sourceNames?: string[]; order: number; archived: boolean;
    commitment?: "committed" | "flexible"; defaultAmount?: number }>;
  subcategories: Array<{
    id: string; categoryId: string; name: string; order: number; archived: boolean;
    kind?: "group" | "cost"; targetEnabled?: boolean; parentSubcategoryId?: string;
    commitment: "committed" | "flexible"; schedule: "none" | "monthly" | "periodic" | "one-time";
    defaultAmount: number; recurringCostId?: string; sourceLabels?: string[];
    expectedAmount?: number; intervalMonths?: number; dueMonth?: string;
  }>;
};

type Row = Record<string, unknown>;

export async function readSharedState(): Promise<SharedState> {
  const db = getDb();
  const [settings, budgets, recurring, categories, cash, catalogVersions, monthPlans, matchBindings] = await Promise.all([
    db.prepare("SELECT currency, opening_balance_cents, buffer_target_cents, updated_at FROM household_settings WHERE id = 1").first<Row>(),
    db.prepare("SELECT month, category, amount_cents FROM budget_overrides ORDER BY month, category").all<Row>(),
    db.prepare("SELECT month, recurring_cost_id, amount_cents, included FROM recurring_plan_overrides ORDER BY month, recurring_cost_id").all<Row>(),
    db.prepare("SELECT category, spending_type, updated_at FROM category_settings ORDER BY category").all<Row>(),
    db.prepare("SELECT * FROM cash_reports ORDER BY report_date DESC, created_at DESC, id").all<Row>(),
    db.prepare("SELECT effective_from_month, catalog_json FROM budget_catalog_versions ORDER BY effective_from_month").all<Row>(),
    db.prepare("SELECT month, allocations_json FROM budget_month_plans ORDER BY month").all<Row>(),
    db.prepare("SELECT bindings_json FROM budget_match_bindings WHERE id = 1").first<Row>(),
  ]);
  const budgetOverridesByMonth: Record<string, Record<string, number>> = {};
  for (const row of budgets.results) {
    const month = String(row.month);
    budgetOverridesByMonth[month] ??= {};
    budgetOverridesByMonth[month][String(row.category)] = Number(row.amount_cents) / 100;
  }
  const recurringOverridesByMonth: SharedState["recurringOverridesByMonth"] = {};
  for (const row of recurring.results) {
    const month = String(row.month);
    recurringOverridesByMonth[month] ??= {};
    recurringOverridesByMonth[month][String(row.recurring_cost_id)] = {
      amount: Number(row.amount_cents) / 100,
      included: Boolean(row.included),
    };
  }
  return {
    settings: {
      currency: settings?.currency ? String(settings.currency) : null,
      openingBalance: settings?.opening_balance_cents === null || settings?.opening_balance_cents === undefined
        ? null
        : Number(settings.opening_balance_cents) / 100,
      bufferTarget: settings?.buffer_target_cents === null || settings?.buffer_target_cents === undefined
        ? null
        : Number(settings.buffer_target_cents) / 100,
      updatedAt: settings?.updated_at ? String(settings.updated_at) : null,
    },
    budgetOverridesByMonth,
    recurringOverridesByMonth,
    categorySettings: Object.fromEntries(categories.results.map((row) => [String(row.category), {
      spendingType: row.spending_type === "flexible" ? "flexible" : "committed",
      updatedAt: row.updated_at ? String(row.updated_at) : null,
    }])),
    budgetCatalogVersions: catalogVersions.results.map((row) => ({
      effectiveFromMonth: String(row.effective_from_month),
      catalog: parseJson<BudgetCatalog>(row.catalog_json, { categories: [], subcategories: [] }),
    })),
    budgetMonthPlans: Object.fromEntries(monthPlans.results.map((row) => [
      String(row.month), parseJson<Record<string, number>>(row.allocations_json, {}),
    ])),
    budgetMatchBindings: matchBindings ? parseJson<BudgetMatchBinding[]>(matchBindings.bindings_json, []) : null,
    travelCashEntries: cash.results.map((row) => ({
      id: String(row.id),
      type: row.type === "saved" ? "saved" : "spent",
      category: String(row.category),
      currency: String(row.currency) as CashCurrency,
      amount: Number(row.amount_minor) / 100,
      nisValue: Number(row.nis_value_cents) / 100,
      rateToNis: Number(row.rate_to_nis),
      rateLabel: String(row.rate_label),
      date: String(row.report_date),
      note: String(row.note || ""),
      createdAt: String(row.created_at),
    })),
  };
}

export function validMonth(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}

export function finiteMoney(value: unknown, minimum = 0): number | null {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount < minimum || Math.abs(amount) > 1_000_000_000) return null;
  return Math.round(amount * 100) / 100;
}

export function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result && result.length <= max ? result : null;
}

export async function parseRequestJson(request: Request): Promise<Record<string, unknown> | Response> {
  try {
    const value = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    return Response.json({ error: "A valid JSON object is required." }, { status: 400 });
  }
}
