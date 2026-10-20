import { getDb } from "../../../../../db";
import { requireApiUser } from "../../../../server/access";
import { readSharedState } from "../../../../server/shared-state";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireApiUser();
  if (access instanceof Response) return access;
  const { id } = await context.params;
  if (!id || id.length > 120) return Response.json({ error: "Invalid cash report." }, { status: 400 });
  await getDb().prepare("DELETE FROM cash_reports WHERE id = ?").bind(id).run();
  return Response.json({ sharedState: await readSharedState() });
}
