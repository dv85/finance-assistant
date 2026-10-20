import { getDb, parseJson } from "../../../../db";
import { resolveBudgetCatalog } from "../../../../src/lib/budgetPlan.js";
import { requireApiUser } from "../../../server/access";
import { cleanText, finiteMoney, parseRequestJson, readSharedState, validMonth, type BudgetCatalog, type BudgetMatchBinding } from "../../../server/shared-state";

const matchKey = (value: string) => value.trim().toLocaleLowerCase();

export function validateBindings(value: unknown, catalog?: BudgetCatalog | null): BudgetMatchBinding[] | null {
  if (!Array.isArray(value) || value.length > 1000) return null;
  const categories = new Map(catalog?.categories.map((row) => [row.id, row]) || []);
  const children = new Map(catalog?.subcategories.map((row) => [row.id, row]) || []);
  const claimed = new Set<string>();
  const bindings: BudgetMatchBinding[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    const categoryId = cleanText(row.categoryId, 120), subcategoryId = cleanText(row.subcategoryId, 120);
    const sourceCategory = cleanText(row.sourceCategory, 100), sourceKey = cleanText(row.sourceKey, 120);
    if (!["label", "recurring", "transaction"].includes(String(row.kind)) || !categoryId || !subcategoryId || !sourceCategory || !sourceKey) return null;
    if (catalog) {
      const category = categories.get(categoryId), child = children.get(subcategoryId);
      if (!category || !child || child.categoryId !== categoryId ||
        ![category.name, ...(category.sourceNames || [])].some((name) => matchKey(name) === matchKey(sourceCategory))) return null;
      if (row.kind === "recurring" && child.recurringCostId !== sourceKey) return null;
    }
    const key = `${row.kind}:${matchKey(sourceCategory)}:${matchKey(sourceKey)}`;
    if (claimed.has(key)) return null;
    claimed.add(key);
    bindings.push({ kind: row.kind as BudgetMatchBinding["kind"], categoryId, subcategoryId, sourceCategory, sourceKey });
  }
  return bindings;
}

export function validateCatalog(value: unknown): BudgetCatalog | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const modern = source.schemaVersion === 2;
  if (source.schemaVersion !== undefined && !modern) return null;
  if (!Array.isArray(source.categories) || !Array.isArray(source.subcategories)
    || source.categories.length > 100 || source.subcategories.length > 500) return null;
  const categoryIds = new Set<string>();
  const categoryKeys = new Map<string, string>();
  const categories: BudgetCatalog["categories"] = [];
  for (const raw of source.categories) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    const id = cleanText(row.id, 120), name = cleanText(row.name, 100);
    const sourceNames = row.sourceNames === undefined ? [] : row.sourceNames;
    const defaultAmount = modern ? finiteMoney(row.defaultAmount) : undefined;
    const commitment = modern ? row.commitment : undefined;
    if (!id || !name || categoryIds.has(id) || !Number.isInteger(row.order) || typeof row.archived !== "boolean"
      || !Array.isArray(sourceNames) || sourceNames.length > 20 || sourceNames.some((item) => !cleanText(item, 100))
      || modern && (defaultAmount === null || !["committed", "flexible"].includes(String(commitment)))) return null;
    for (const key of [name, ...sourceNames as string[]]) {
      const normalized = key.trim().toLocaleLowerCase();
      const owner = categoryKeys.get(normalized);
      if (owner && owner !== id) return null;
      categoryKeys.set(normalized, id);
    }
    categoryIds.add(id);
    categories.push({ id, name, sourceNames: sourceNames as string[], order: Number(row.order), archived: row.archived,
      ...(modern ? { defaultAmount: defaultAmount as number, commitment: commitment as "committed" | "flexible" } : {}) });
  }
  const subcategoryIds = new Set<string>();
  const subcategories: BudgetCatalog["subcategories"] = [];
  for (const raw of source.subcategories) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const row = raw as Record<string, unknown>;
    const id = cleanText(row.id, 120), categoryId = cleanText(row.categoryId, 120), name = cleanText(row.name, 100);
    const defaultAmount = finiteMoney(row.defaultAmount);
    const commitment = row.commitment, schedule = row.schedule;
    const sourceLabels = row.sourceLabels === undefined ? [] : row.sourceLabels;
    const kind = modern ? row.kind : undefined;
    const targetEnabled = modern ? row.targetEnabled : undefined;
    const parentSubcategoryId = row.parentSubcategoryId === undefined ? undefined : cleanText(row.parentSubcategoryId, 120);
    if (!id || !categoryId || !categoryIds.has(categoryId) || !name || subcategoryIds.has(id)
      || !Number.isInteger(row.order) || typeof row.archived !== "boolean" || defaultAmount === null
      || !["committed", "flexible"].includes(String(commitment))
      || !["none", "monthly", "periodic", "one-time"].includes(String(schedule))
      || !Array.isArray(sourceLabels) || sourceLabels.length > 20
      || sourceLabels.some((item) => !cleanText(item, 100))
      || modern && (!["group", "cost"].includes(String(kind)) || typeof targetEnabled !== "boolean"
        || kind === "cost" && targetEnabled || kind === "group" && schedule !== "none"
        || row.parentSubcategoryId !== undefined && !parentSubcategoryId)) return null;
    const recurringCostId = row.recurringCostId === undefined ? undefined : cleanText(row.recurringCostId, 120);
    if (row.recurringCostId !== undefined && !recurringCostId) return null;
    const expectedAmount = row.expectedAmount === undefined ? undefined : finiteMoney(row.expectedAmount);
    if (row.expectedAmount !== undefined && expectedAmount === null) return null;
    const intervalMonths = row.intervalMonths === undefined ? undefined : Number(row.intervalMonths);
    if (intervalMonths !== undefined && (!Number.isInteger(intervalMonths) || intervalMonths < 1 || intervalMonths > 120)) return null;
    const dueMonth = row.dueMonth === undefined ? undefined : row.dueMonth;
    if (dueMonth !== undefined && !validMonth(dueMonth)) return null;
    if (schedule === "one-time" && !dueMonth) return null;
    subcategoryIds.add(id);
    subcategories.push({ id, categoryId, name, order: Number(row.order), archived: row.archived,
      commitment: commitment as "committed" | "flexible", schedule: schedule as BudgetCatalog["subcategories"][number]["schedule"],
      defaultAmount, ...(recurringCostId ? { recurringCostId } : {}), sourceLabels: sourceLabels as string[],
      ...(modern ? { kind: kind as "group" | "cost", targetEnabled: targetEnabled as boolean } : {}),
      ...(parentSubcategoryId ? { parentSubcategoryId } : {}),
      ...(expectedAmount !== undefined ? { expectedAmount: expectedAmount as number } : {}),
      ...(intervalMonths !== undefined ? { intervalMonths } : {}), ...(dueMonth ? { dueMonth: String(dueMonth) } : {}) });
  }
  if (modern) {
    const names = new Set<string>();
    for (const row of subcategories) {
      const key = `${row.categoryId}:${matchKey(row.name)}`;
      if (names.has(key)) return null;
      names.add(key);
      if (!row.parentSubcategoryId) continue;
      const parent = subcategories.find((item) => item.id === row.parentSubcategoryId);
      if (row.kind !== "cost" || parent?.kind !== "group" || parent.categoryId !== row.categoryId) return null;
    }
  }
  return { ...(modern ? { schemaVersion: 2 as const } : {}), categories, subcategories };
}

function reservationError(catalog: BudgetCatalog, allocations: Record<string, number>, month: string): string | null {
  if (catalog.schemaVersion !== 2) return null;
  const planned = (item: { id: string; defaultAmount?: number; archived: boolean; schedule?: string; dueMonth?: string }) =>
    item.archived || item.schedule === "one-time" && item.dueMonth !== month ? 0
      : allocations[item.id] ?? item.defaultAmount ?? 0;
  for (const category of catalog.categories.filter((row) => !row.archived)) {
    const children = catalog.subcategories.filter((row) => row.categoryId === category.id && !row.archived);
    const groups = children.filter((row) => row.kind === "group" && row.targetEnabled);
    const costs = children.filter((row) => row.kind === "cost");
    for (const group of groups) {
      if (costs.filter((row) => row.parentSubcategoryId === group.id).reduce((total, row) => total + planned(row), 0) > planned(group))
        return `${group.name} has known costs above its target.`;
    }
    const reserved = groups.reduce((total, row) => total + planned(row), 0) +
      costs.filter((row) => !groups.some((group) => group.id === row.parentSubcategoryId))
        .reduce((total, row) => total + planned(row), 0);
    if (reserved > planned(category)) return `${category.name} reserves more than its monthly total.`;
  }
  return null;
}

export async function PUT(request: Request) {
  const access = await requireApiUser();
  if (access instanceof Response) return access;
  const body = await parseRequestJson(request);
  if (body instanceof Response) return body;
  const hasCatalog = body.catalog !== undefined;
  const hasAllocations = body.allocations !== undefined;
  const hasBindings = body.bindings !== undefined;
  const bufferTarget = body.bufferTarget === undefined ? null : finiteMoney(body.bufferTarget);
  if (body.bufferTarget !== undefined && (bufferTarget === null || !hasAllocations)) {
    return Response.json({ error: "An allowance setup needs a valid non-negative buffer and monthly budget plan." }, { status: 400 });
  }
  if (!hasCatalog && !hasAllocations && !hasBindings) return Response.json({ error: "A catalog, match list, or month plan is required." }, { status: 400 });
  if (hasBindings && !hasCatalog) return Response.json({ error: "Budget matches must be saved with their catalog." }, { status: 400 });
  const catalog = hasCatalog ? validateCatalog(body.catalog) : null;
  if (hasCatalog && (!catalog || !validMonth(body.effectiveFromMonth))) {
    return Response.json({ error: "The budget catalog or effective month is invalid." }, { status: 400 });
  }
  if (hasAllocations && (!validMonth(body.month) || !body.allocations || typeof body.allocations !== "object" || Array.isArray(body.allocations))) {
    return Response.json({ error: "The monthly plan is invalid." }, { status: 400 });
  }
  const bindings = hasBindings ? validateBindings(body.bindings, catalog) : null;
  if (hasBindings && !bindings) return Response.json({ error: "Budget matches must be unique reviewed labels or recurring IDs within their source category." }, { status: 400 });
  const allocations: Record<string, number> = {};
  if (hasAllocations) {
    const entries = Object.entries(body.allocations as Record<string, unknown>);
    if (entries.length > 600) return Response.json({ error: "Too many budget amounts." }, { status: 400 });
    for (const [rawId, rawAmount] of entries) {
      const id = cleanText(rawId, 120), value = finiteMoney(rawAmount);
      if (!id || value === null) return Response.json({ error: "Every subcategory needs a valid non-negative amount." }, { status: 400 });
      allocations[id] = value;
    }
    if (catalog && entries.some(([id]) => !catalog.subcategories.some((row) => row.id === id) &&
      !catalog.categories.some((row) => row.id === id))) {
      return Response.json({ error: "The month plan contains an unknown category or plan item." }, { status: 400 });
    }
  }
  let activeCatalog = catalog;
  if (hasAllocations && !activeCatalog) {
    const sharedState = await readSharedState();
    const stateRow = await getDb().prepare(`
      SELECT state_json FROM snapshot_state
      WHERE snapshot_id = (SELECT active_snapshot_id FROM app_config WHERE id = 1)
    `).first<{ state_json: string }>();
    const state = parseJson<Record<string, unknown>>(stateRow?.state_json, {});
    activeCatalog = resolveBudgetCatalog(state, { recurringCosts: state.recurringCosts || [] }, sharedState, String(body.month));
    if (!activeCatalog) return Response.json({ error: "No budget catalog is available." }, { status: 400 });
    const knownIds = new Set([...activeCatalog.categories, ...activeCatalog.subcategories].map(row => row.id));
    if (Object.keys(allocations).some(id => !knownIds.has(id))) {
      return Response.json({ error: "The month plan contains an unknown category or plan item." }, { status: 400 });
    }
  }
  const error = hasAllocations && activeCatalog && reservationError(activeCatalog, allocations, String(body.month));
  if (error) return Response.json({ error }, { status: 400 });
  const db = getDb();
  const statements = [];
  if (catalog) statements.push(db.prepare(`
    INSERT INTO budget_catalog_versions (effective_from_month, catalog_json, updated_by, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(effective_from_month) DO UPDATE SET catalog_json = excluded.catalog_json,
      updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP
  `).bind(body.effectiveFromMonth, JSON.stringify(catalog), access.user.userId));
  if (bindings) statements.push(db.prepare(`
    INSERT INTO budget_match_bindings (id, bindings_json, updated_by, updated_at)
    VALUES (1, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET bindings_json = excluded.bindings_json,
      updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP
  `).bind(JSON.stringify(bindings), access.user.userId));
  if (hasAllocations) statements.push(db.prepare(`
    INSERT INTO budget_month_plans (month, allocations_json, updated_by, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(month) DO UPDATE SET allocations_json = excluded.allocations_json,
      updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP
  `).bind(body.month, JSON.stringify(allocations), access.user.userId));
  // One D1 transaction saves the setup; a failed plan must not leave a changed buffer.
  if (bufferTarget !== null) statements.push(db.prepare(`
    INSERT INTO household_settings (id, buffer_target_cents, updated_by, updated_at)
    VALUES (1, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(id) DO UPDATE SET buffer_target_cents = excluded.buffer_target_cents,
      updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP
  `).bind(Math.round(bufferTarget * 100), access.user.userId));
  await db.batch(statements);
  return Response.json({ sharedState: await readSharedState() });
}
