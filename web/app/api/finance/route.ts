import { getDb, parseJson } from "../../../db";
import { requireApiUser } from "../../server/access";
import { readSharedState } from "../../server/shared-state";

export const dynamic = "force-dynamic";

type D1Row = Record<string, unknown>;

export async function GET() {
  const access = await requireApiUser();
  if (access instanceof Response) return access;
  const db = getDb();
  const sharedState = await readSharedState();
  const config = await db.prepare("SELECT active_snapshot_id FROM app_config WHERE id = 1").first<{ active_snapshot_id: string | null }>();
  const snapshotId = config?.active_snapshot_id;
  if (!snapshotId) {
    return Response.json({ state: null, ledger: null, sharedState, source: "Local D1", isOwner: access.isOwner, user: access.user });
  }

  const [stateRow, accountResult, transactionResult, balanceResult, importResult] = await Promise.all([
    db.prepare("SELECT state_json FROM snapshot_state WHERE snapshot_id = ?").bind(snapshotId).first<{ state_json: string }>(),
    db.prepare("SELECT * FROM accounts WHERE snapshot_id = ? ORDER BY name").bind(snapshotId).all<D1Row>(),
    db.prepare("SELECT * FROM transactions WHERE snapshot_id = ? ORDER BY reporting_date DESC, source_id").bind(snapshotId).all<D1Row>(),
    db.prepare("SELECT * FROM balance_snapshots WHERE snapshot_id = ? ORDER BY snapshot_date DESC").bind(snapshotId).all<D1Row>(),
    db.prepare("SELECT * FROM import_runs WHERE snapshot_id = ? ORDER BY imported_at DESC").bind(snapshotId).all<D1Row>(),
  ]);

  const state = parseJson<Record<string, unknown>>(stateRow?.state_json, {});
  const ledger = {
    installmentPlans: state.installmentPlans ?? [],
    recurringCosts: state.recurringCosts ?? [],
    schemaVersion: 1,
    currency: state.currency ?? "ILS",
    accounts: accountResult.results.map((row) => ({
      ...parseJson<Record<string, unknown>>(row.payload_json, {}),
      id: row.source_id,
      name: row.name,
      type: row.type,
      currency: row.currency,
      provider: row.provider,
      cardLast4: row.card_last4,
    })),
    transactions: transactionResult.results.map((row) => ({
      ...parseJson<Record<string, unknown>>(row.metadata_json, {}),
      id: row.source_id,
      fingerprint: row.fingerprint,
      date: row.transaction_date,
      billingDate: row.billing_date,
      isInstallment: Boolean(row.is_installment),
      description: row.description,
      merchant: row.merchant,
      normalizedMerchantName: row.normalized_merchant_name,
      merchantDescription: row.merchant_description,
      amount: Number(row.amount_cents) / 100,
      currency: row.currency,
      direction: row.direction,
      type: row.type,
      category: row.category,
      costLabel: row.cost_label,
      source: row.source_label,
    })),
    balanceSnapshots: balanceResult.results.map((row) => ({
      ...parseJson<Record<string, unknown>>(row.payload_json, {}),
      id: row.source_id,
      date: row.snapshot_date,
      observed_balance: Number(row.observed_balance_cents) / 100,
      currency: row.currency,
    })),
    importRuns: importResult.results.map((row) => ({
      ...parseJson<Record<string, unknown>>(row.payload_json, {}),
      id: row.source_id,
      label: row.label,
      status: row.status,
      importedAt: row.imported_at,
      transactionCount: row.transaction_count,
      warningCount: row.warning_count,
    })),
  };

  return Response.json({ state, ledger, sharedState, source: "Local D1", isOwner: access.isOwner, user: access.user });
}
