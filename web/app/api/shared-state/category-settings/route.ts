import { getDb } from "../../../../db";
import { requireApiUser } from "../../../server/access";
import { cleanText, parseRequestJson, readSharedState } from "../../../server/shared-state";

export async function PUT(request: Request) {
  const access = await requireApiUser();
  if (access instanceof Response) return access;
  const body = await parseRequestJson(request);
  if (body instanceof Response) return body;
  const source = body.settings;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return Response.json({ error: "Category settings must be an object." }, { status: 400 });
  }

  const values: Array<[string, "committed" | "flexible"]> = [];
  for (const [rawCategory, rawValue] of Object.entries(source)) {
    const category = cleanText(rawCategory, 100);
    const spendingType = typeof rawValue === "object" && rawValue && !Array.isArray(rawValue)
      ? (rawValue as Record<string, unknown>).spendingType
      : rawValue;
    if (!category || !["committed", "flexible"].includes(String(spendingType))) {
      return Response.json({ error: "Every category needs a valid Committed or Flexible type." }, { status: 400 });
    }
    values.push([category, spendingType as "committed" | "flexible"]);
  }
  if (values.length > 100) return Response.json({ error: "Too many category settings." }, { status: 400 });

  const db = getDb();
  const statements = [db.prepare("DELETE FROM category_settings")];
  for (const [category, spendingType] of values) {
    statements.push(db.prepare(`
      INSERT INTO category_settings (category, spending_type, updated_by, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `).bind(category, spendingType, access.user.userId));
  }
  await db.batch(statements);
  return Response.json({ sharedState: await readSharedState() });
}
