import { getDb } from "../../../../db";
import { normalizeEmail, requireOwner, validMemberEmail } from "../../../server/access";

type Context = { params: Promise<{ email: string }> };

export async function DELETE(_request: Request, context: Context) {
  const access = await requireOwner();
  if (access instanceof Response) return access;
  const { email: rawEmail } = await context.params;
  const email = normalizeEmail(rawEmail);
  if (!validMemberEmail(email)) return Response.json({ error: "Member email is invalid." }, { status: 400 });
  if (email === normalizeEmail(access.user.email)) return Response.json({ error: "The owner cannot be removed." }, { status: 400 });
  const result = await getDb().prepare("DELETE FROM household_members WHERE email = ?").bind(email).run();
  if (!result.meta.changes) return Response.json({ error: "That member no longer has household access." }, { status: 404 });
  return new Response(null, { status: 204 });
}
