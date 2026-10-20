import { getDb, parseJson } from "../../../../../../db";
import { requireOwnerOrSync } from "../../../../../server/access";

type Expected = {
  accounts?: number;
  transactions?: number;
  balanceSnapshots?: number;
  importRuns?: number;
  transactionAmountCents?: number;
};

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireOwnerOrSync(request);
  if (access instanceof Response) return access;
  const { id } = await context.params;
  const db = getDb();
  const snapshot = await db.prepare("SELECT status, expected_json FROM data_snapshots WHERE id = ?").bind(id).first<{ status: string; expected_json: string }>();
  if (snapshot?.status !== "staging") return Response.json({ error: "Import is not staging" }, { status: 409 });
  const expected = parseJson<Expected>(snapshot.expected_json, {});
  const [accounts, transactions, balances, imports, amount] = await Promise.all([
    count(db, "accounts", id), count(db, "transactions", id), count(db, "balance_snapshots", id), count(db, "import_runs", id),
    db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM transactions WHERE snapshot_id = ?").bind(id).first<{ total: number }>(),
  ]);
  const actual = {
    accounts,
    transactions,
    balanceSnapshots: balances,
    importRuns: imports,
    transactionAmountCents: Number(amount?.total ?? 0),
  };
  const mismatches = Object.entries(actual).filter(([key, value]) => expected[key as keyof Expected] !== value);
  if (mismatches.length) return Response.json({ error: "Import reconciliation failed", expected, actual }, { status: 422 });

  await db.batch([
    db.prepare("UPDATE data_snapshots SET status = 'superseded' WHERE status = 'active'"),
    db.prepare("UPDATE data_snapshots SET status = 'active', activated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(id),
    db.prepare("UPDATE app_config SET active_snapshot_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1").bind(id),
  ]);
  return Response.json({ status: "active", snapshotId: id });
}

async function count(db: D1Database, table: string, snapshotId: string): Promise<number> {
  const allowed = new Set(["accounts", "transactions", "balance_snapshots", "import_runs"]);
  if (!allowed.has(table)) throw new Error("Unsupported table");
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE snapshot_id = ?`).bind(snapshotId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}
