import { getDb } from "../../../../../db";
import { requireApiUser } from "../../../../server/access";
import { cleanText, finiteMoney, parseRequestJson, readSharedState, validMonth } from "../../../../server/shared-state";

type Context = { params: Promise<{ month: string }> };

export async function PUT(request: Request, context: Context) {
  const access = await requireApiUser();
  if (access instanceof Response) return access;
  const { month } = await context.params;
  if (!validMonth(month)) return Response.json({ error: "Month must use YYYY-MM." }, { status: 400 });
  const body = await parseRequestJson(request);
  if (body instanceof Response) return body;
  const source = body.overrides;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return Response.json({ error: "Recurring overrides must be an object." }, { status: 400 });
  }
  const values: Array<[string, number, boolean]> = [];
  for (const [rawId, rawValue] of Object.entries(source)) {
    const id = cleanText(rawId, 120);
    if (!id || !rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) {
      return Response.json({ error: "Every recurring override needs a valid item." }, { status: 400 });
    }
    const row = rawValue as Record<string, unknown>;
    const amount = finiteMoney(row.amount);
    if (amount === null || typeof row.included !== "boolean") {
      return Response.json({ error: "Every recurring override needs a non-negative amount and inclusion choice." }, { status: 400 });
    }
    values.push([id, amount, row.included]);
  }
  if (values.length > 100) return Response.json({ error: "Too many recurring overrides." }, { status: 400 });
  const db = getDb();
  const statements = [db.prepare("DELETE FROM recurring_plan_overrides WHERE month = ?").bind(month)];
  for (const [id, amount, included] of values) {
    statements.push(db.prepare(`
      INSERT INTO recurring_plan_overrides (month, recurring_cost_id, amount_cents, included, updated_by, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(month, id, Math.round(amount * 100), included ? 1 : 0, access.user.userId));
  }
  await db.batch(statements);
  return Response.json({ sharedState: await readSharedState() });
}

export async function DELETE(_request: Request, context: Context) {
  const access = await requireApiUser();
  if (access instanceof Response) return access;
  const { month } = await context.params;
  if (!validMonth(month)) return Response.json({ error: "Month must use YYYY-MM." }, { status: 400 });
  await getDb().prepare("DELETE FROM recurring_plan_overrides WHERE month = ?").bind(month).run();
  return Response.json({ sharedState: await readSharedState() });
}
