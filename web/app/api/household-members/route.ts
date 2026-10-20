import { getDb } from "../../../db";
import { normalizeEmail, requireOwner, validMemberEmail } from "../../server/access";
import { parseRequestJson } from "../../server/shared-state";

type MemberRow = { email: string; added_at: string };

export async function GET() {
  const access = await requireOwner();
  if (access instanceof Response) return access;
  const result = await getDb().prepare("SELECT email, added_at FROM household_members WHERE status = 'active' ORDER BY email").all<MemberRow>();
  const members = result.results as MemberRow[];
  return Response.json({ members: members.map((member: MemberRow) => ({ email: member.email, addedAt: member.added_at })) });
}

export async function POST(request: Request) {
  const access = await requireOwner();
  if (access instanceof Response) return access;
  const body = await parseRequestJson(request);
  if (body instanceof Response) return body;
  const email = typeof body.email === "string" ? normalizeEmail(body.email) : "";
  if (!validMemberEmail(email)) return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  if (email === normalizeEmail(access.user.email)) return Response.json({ error: "The owner already has access." }, { status: 400 });
  const db = getDb();
  const existing = await db.prepare("SELECT email FROM household_members WHERE email = ?").bind(email).first<{ email: string }>();
  if (existing) return Response.json({ error: "That email already has household access." }, { status: 409 });
  await db.prepare(`
    INSERT INTO household_members (email, status, added_by, added_at, updated_at)
    VALUES (?, 'active', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(email, access.user.userId).run();
  return Response.json({ member: { email } }, { status: 201 });
}
