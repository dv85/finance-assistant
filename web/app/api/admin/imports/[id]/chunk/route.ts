import { getDb } from "../../../../../../db";
import { requireOwnerOrSync } from "../../../../../server/access";

const MAX_ROWS = 100;
const ENTITIES = new Set(["accounts", "transactions", "balanceSnapshots", "importRuns"]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const access = await requireOwnerOrSync(request);
  if (access instanceof Response) return access;
  const { id } = await context.params;
  const body = await request.json() as { entity?: string; rows?: Array<Record<string, unknown>> };
  const entity = body.entity ?? "";
  const rows = body.rows ?? [];
  if (!ENTITIES.has(entity) || !Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS) {
    return Response.json({ error: "A supported entity and 1-100 rows are required" }, { status: 400 });
  }
  const db = getDb();
  const snapshot = await db.prepare("SELECT status FROM data_snapshots WHERE id = ?").bind(id).first<{ status: string }>();
  if (snapshot?.status !== "staging") return Response.json({ error: "Import is not staging" }, { status: 409 });

  try {
    const statements = rows.map((row) => prepareRow(db, id, entity, row));
    await db.batch(statements);
    return Response.json({ accepted: rows.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid import row" }, { status: 400 });
  }
}

function prepareRow(db: D1Database, snapshotId: string, entity: string, row: Record<string, unknown>): D1PreparedStatement {
  const sourceId = requiredString(row.sourceId, "sourceId");
  if (entity === "accounts") {
    return db.prepare(`INSERT OR REPLACE INTO accounts
      (snapshot_id, source_id, name, type, currency, provider, card_last4, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        snapshotId, sourceId, requiredString(row.name, "name"), requiredString(row.type, "type"),
        stringValue(row.currency, "ILS"), nullableString(row.provider), nullableString(row.cardLast4), jsonValue(row.payload),
      );
  }
  if (entity === "transactions") {
    return db.prepare(`INSERT OR REPLACE INTO transactions
      (snapshot_id, source_id, fingerprint, transaction_date, billing_date, reporting_date, is_installment,
       description, merchant, normalized_merchant_name, merchant_description, amount_cents, currency, direction,
       type, category, cost_label, source_label, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
        snapshotId, sourceId, nullableString(row.fingerprint), requiredDate(row.transactionDate, "transactionDate"),
        nullableDate(row.billingDate), requiredDate(row.reportingDate, "reportingDate"), row.isInstallment ? 1 : 0,
        requiredString(row.description, "description"), nullableString(row.merchant), nullableString(row.normalizedMerchantName),
        nullableString(row.merchantDescription), requiredInteger(row.amountCents, "amountCents"), stringValue(row.currency, "ILS"),
        requiredString(row.direction, "direction"), stringValue(row.type, "expense"), stringValue(row.category, "Other"),
        nullableString(row.costLabel), nullableString(row.sourceLabel), jsonValue(row.metadata),
      );
  }
  if (entity === "balanceSnapshots") {
    return db.prepare(`INSERT OR REPLACE INTO balance_snapshots
      (snapshot_id, source_id, snapshot_date, observed_balance_cents, currency, payload_json)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(
        snapshotId, sourceId, requiredDate(row.snapshotDate, "snapshotDate"), requiredInteger(row.observedBalanceCents, "observedBalanceCents"),
        stringValue(row.currency, "ILS"), jsonValue(row.payload),
      );
  }
  return db.prepare(`INSERT OR REPLACE INTO import_runs
    (snapshot_id, source_id, label, status, imported_at, transaction_count, warning_count, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      snapshotId, sourceId, requiredString(row.label, "label"), stringValue(row.status, "completed"),
      nullableString(row.importedAt), integerValue(row.transactionCount), integerValue(row.warningCount), jsonValue(row.payload),
    );
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value;
}
function stringValue(value: unknown, fallback: string): string { return typeof value === "string" && value ? value : fallback; }
function nullableString(value: unknown): string | null { return typeof value === "string" && value ? value : null; }
function requiredInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value)) throw new Error(`${field} must be an integer`);
  return Number(value);
}
function integerValue(value: unknown): number { return Number.isInteger(value) ? Number(value) : 0; }
function requiredDate(value: unknown, field: string): string {
  const result = requiredString(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error(`${field} must be YYYY-MM-DD`);
  return result;
}
function nullableDate(value: unknown): string | null { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null; }
function jsonValue(value: unknown): string { return JSON.stringify(value && typeof value === "object" ? value : {}); }
