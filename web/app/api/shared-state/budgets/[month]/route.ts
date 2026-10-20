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
    return Response.json({ error: "Budget overrides must be an object." }, { status: 400 });
  }
  const values: Array<[string, number]> = [];
  for (const [rawCategory, rawAmount] of Object.entries(source)) {
    const category = cleanText(rawCategory, 100);
    const amount = finiteMoney(rawAmount);
    if (!category || amount === null) return Response.json({ error: "Every category needs a valid non-negative budget." }, { status: 400 });
    values.push([category, amount]);
  }
  if (values.length > 100) return Response.json({ error: "Too many budget categories." }, { status: 400 });
  const db = getDb();
  const statements = [db.prepare("DELETE FROM budget_overrides WHERE month = ?").bind(month)];
  for (const [category, amount] of values) {
    statements.push(db.prepare(`
      INSERT INTO budget_overrides (month, category, amount_cents, updated_by, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(month, category, Math.round(amount * 100), access.user.userId));
  }
  await db.batch(statements);
  return Response.json({ sharedState: await readSharedState() });
}

export async function DELETE(_request: Request, context: Context) {
  const access = await requireApiUser();
  if (access instanceof Response) return access;
  const { month } = await context.params;
  if (!validMonth(month)) return Response.json({ error: "Month must use YYYY-MM." }, { status: 400 });
  await getDb().prepare("DELETE FROM budget_overrides WHERE month = ?").bind(month).run();
  return Response.json({ sharedState: await readSharedState() });
}
