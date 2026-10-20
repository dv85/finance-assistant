import type { ChatGPTUser } from "../chatgpt-auth";
import { getChatGPTUser } from "../chatgpt-auth";
import { getDb } from "../../db";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FinanceAccess = { user: ChatGPTUser; isOwner: boolean };

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validMemberEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

export async function registerUser(user: ChatGPTUser): Promise<FinanceAccess | null> {
  const db = getDb();
  await db.prepare("INSERT OR IGNORE INTO app_config (id, owner_user_id) VALUES (1, ?)").bind(user.userId).run();
  const config = await db.prepare("SELECT owner_user_id FROM app_config WHERE id = 1").first<{ owner_user_id: string }>();
  const isOwner = config?.owner_user_id === user.userId;
  const email = normalizeEmail(user.email);
  if (!isOwner) {
    const member = await db.prepare("SELECT email FROM household_members WHERE email = ? AND status = 'active'").bind(email).first<{ email: string }>();
    if (!member) return null;
  }
  await db.prepare(`
    INSERT INTO finance_users (user_id, email, display_name, role)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      email = excluded.email,
      display_name = excluded.display_name,
      role = excluded.role,
      last_seen_at = CURRENT_TIMESTAMP
  `).bind(user.userId, email, user.displayName, isOwner ? "owner" : "member").run();
  return { user: { ...user, email }, isOwner };
}

export async function requireApiUser(): Promise<FinanceAccess | Response> {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  const access = await registerUser(user);
  if (!access) return Response.json({ error: "This account has not been invited to this household." }, { status: 403 });
  return access;
}

export async function requireOwner(): Promise<{ user: ChatGPTUser } | Response> {
  const access = await requireApiUser();
  if (access instanceof Response) return access;
  if (!access.isOwner) return Response.json({ error: "Owner access required" }, { status: 403 });
  return { user: access.user };
}

export async function requireOwnerOrSync(request: Request): Promise<{ user: ChatGPTUser; isAutomation: boolean } | Response> {
  const access = await requireOwner();
  if (access instanceof Response) return access;
  return { ...access, isAutomation: false };
}

