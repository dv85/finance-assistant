import { getDb, parseJson } from "../../../../db";
import { requireOwnerOrSync } from "../../../server/access";

type Expected = {
  accounts?: number;
  transactions?: number;
  balanceSnapshots?: number;
  importRuns?: number;
  transactionAmountCents?: number;
};

export async function GET(request: Request) {
  const access = await requireOwnerOrSync(request);
  if (access instanceof Response) return access;
  const db = getDb();
  const active = await db.prepare(`SELECT snapshots.id, snapshots.source_hash, snapshots.expected_json
    FROM app_config config
    LEFT JOIN data_snapshots snapshots ON snapshots.id = config.active_snapshot_id
    WHERE config.id = 1`).first<{ id: string | null; source_hash: string | null; expected_json: string | null }>();
  if (!active?.id) return Response.json({ active: false });
  const [accounts, transactions, balances, imports, amount] = await Promise.all([
    count(db, "accounts", active.id),
    count(db, "transactions", active.id),
    count(db, "balance_snapshots", active.id),
    count(db, "import_runs", active.id),
    db.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS total FROM transactions WHERE snapshot_id = ?")
      .bind(active.id).first<{ total: number }>(),
  ]);
  return Response.json({
    active: true,
    snapshotId: active.id,
    sourceHash: active.source_hash,
    expected: parseJson<Expected>(active.expected_json, {}),
    actual: {
      accounts,
      transactions,
      balanceSnapshots: balances,
      importRuns: imports,
      transactionAmountCents: Number(amount?.total ?? 0),
    },
  });
}

async function count(db: D1Database, table: string, snapshotId: string): Promise<number> {
  const allowed = new Set(["accounts", "transactions", "balance_snapshots", "import_runs"]);
  if (!allowed.has(table)) throw new Error("Unsupported table");
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE snapshot_id = ?`)
    .bind(snapshotId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}
