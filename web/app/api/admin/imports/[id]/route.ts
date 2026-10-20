import { getDb } from "../../../../../db";
import { requireOwnerOrSync } from "../../../../server/access";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireOwnerOrSync(request);
  if (access instanceof Response) return access;
  const { id } = await context.params;
  const result = await getDb().prepare("DELETE FROM data_snapshots WHERE id = ? AND status = 'staging'").bind(id).run();
  return Response.json({ deleted: result.meta.changes > 0 });
}
