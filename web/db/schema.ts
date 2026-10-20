import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const appConfig = sqliteTable("app_config", {
  id: integer("id").primaryKey(),
  ownerUserId: text("owner_user_id"),
  activeSnapshotId: text("active_snapshot_id"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const snapshots = sqliteTable("data_snapshots", {
  id: text("id").primaryKey(),
  status: text("status", { enum: ["staging", "active", "superseded", "failed"] }).notNull(),
  sourceHash: text("source_hash").notNull(),
  schemaVersion: text("schema_version").notNull(),
  expectedJson: text("expected_json").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  activatedAt: text("activated_at"),
}, (table) => [index("idx_data_snapshots_status_created").on(table.status, table.createdAt)]);

export const snapshotState = sqliteTable("snapshot_state", {
  snapshotId: text("snapshot_id").primaryKey().references(() => snapshots.id, { onDelete: "cascade" }),
  stateJson: text("state_json").notNull(),
});

export const accounts = sqliteTable("accounts", {
  snapshotId: text("snapshot_id").notNull().references(() => snapshots.id, { onDelete: "cascade" }),
  sourceId: text("source_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  currency: text("currency").notNull().default("ILS"),
  provider: text("provider"),
  cardLast4: text("card_last4"),
  payloadJson: text("payload_json").notNull().default("{}"),
}, (table) => [primaryKey({ columns: [table.snapshotId, table.sourceId] })]);

export const transactions = sqliteTable("transactions", {
  snapshotId: text("snapshot_id").notNull().references(() => snapshots.id, { onDelete: "cascade" }),
  sourceId: text("source_id").notNull(),
  fingerprint: text("fingerprint"),
  transactionDate: text("transaction_date").notNull(),
  billingDate: text("billing_date"),
  reportingDate: text("reporting_date").notNull(),
  isInstallment: integer("is_installment", { mode: "boolean" }).notNull().default(false),
  description: text("description").notNull(),
  merchant: text("merchant"),
  normalizedMerchantName: text("normalized_merchant_name"),
  merchantDescription: text("merchant_description"),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("ILS"),
  direction: text("direction").notNull(),
  type: text("type").notNull(),
  category: text("category").notNull(),
  costLabel: text("cost_label"),
  sourceLabel: text("source_label"),
  metadataJson: text("metadata_json").notNull().default("{}"),
}, (table) => [
  primaryKey({ columns: [table.snapshotId, table.sourceId] }),
  index("idx_transactions_snapshot_reporting").on(table.snapshotId, table.reportingDate),
  index("idx_transactions_snapshot_category_reporting").on(table.snapshotId, table.category, table.reportingDate),
]);

export const balanceSnapshots = sqliteTable("balance_snapshots", {
  snapshotId: text("snapshot_id").notNull().references(() => snapshots.id, { onDelete: "cascade" }),
  sourceId: text("source_id").notNull(),
  snapshotDate: text("snapshot_date").notNull(),
  observedBalanceCents: integer("observed_balance_cents").notNull(),
  currency: text("currency").notNull().default("ILS"),
  payloadJson: text("payload_json").notNull().default("{}"),
}, (table) => [
  primaryKey({ columns: [table.snapshotId, table.sourceId] }),
  index("idx_balance_snapshots_snapshot_date").on(table.snapshotId, table.snapshotDate),
]);

export const importRuns = sqliteTable("import_runs", {
  snapshotId: text("snapshot_id").notNull().references(() => snapshots.id, { onDelete: "cascade" }),
  sourceId: text("source_id").notNull(),
  label: text("label").notNull(),
  status: text("status").notNull(),
  importedAt: text("imported_at"),
  transactionCount: integer("transaction_count").notNull().default(0),
  warningCount: integer("warning_count").notNull().default(0),
  payloadJson: text("payload_json").notNull().default("{}"),
}, (table) => [
  primaryKey({ columns: [table.snapshotId, table.sourceId] }),
  index("idx_import_runs_snapshot_imported").on(table.snapshotId, table.importedAt),
]);

export const financeUsers = sqliteTable("finance_users", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name"),
  role: text("role", { enum: ["owner", "member"] }).notNull().default("member"),
  firstSeenAt: text("first_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const householdMembers = sqliteTable("household_members", {
  email: text("email").primaryKey(),
  status: text("status", { enum: ["active"] }).notNull().default("active"),
  addedBy: text("added_by").notNull(),
  addedAt: text("added_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const householdSettings = sqliteTable("household_settings", {
  id: integer("id").primaryKey(),
  currency: text("currency"),
  openingBalanceCents: integer("opening_balance_cents"),
  bufferTargetCents: integer("buffer_target_cents"),
  updatedBy: text("updated_by"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const categorySettings = sqliteTable("category_settings", {
  category: text("category").primaryKey(),
  spendingType: text("spending_type", { enum: ["committed", "flexible"] }).notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const budgetOverrides = sqliteTable("budget_overrides", {
  month: text("month").notNull(),
  category: text("category").notNull(),
  amountCents: integer("amount_cents").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.month, table.category] }),
  index("idx_budget_overrides_month").on(table.month),
]);

export const recurringPlanOverrides = sqliteTable("recurring_plan_overrides", {
  month: text("month").notNull(),
  recurringCostId: text("recurring_cost_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  included: integer("included", { mode: "boolean" }).notNull().default(true),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  primaryKey({ columns: [table.month, table.recurringCostId] }),
  index("idx_recurring_plan_overrides_month").on(table.month),
]);

export const budgetCatalogVersions = sqliteTable("budget_catalog_versions", {
  effectiveFromMonth: text("effective_from_month").primaryKey(),
  catalogJson: text("catalog_json").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const budgetMonthPlans = sqliteTable("budget_month_plans", {
  month: text("month").primaryKey(),
  allocationsJson: text("allocations_json").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const budgetMatchBindings = sqliteTable("budget_match_bindings", {
  id: integer("id").primaryKey(),
  bindingsJson: text("bindings_json").notNull(),
  updatedBy: text("updated_by").notNull(),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const cashReports = sqliteTable("cash_reports", {
  id: text("id").primaryKey(),
  type: text("type", { enum: ["spent", "saved"] }).notNull(),
  category: text("category").notNull(),
  currency: text("currency").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  rateToNis: real("rate_to_nis").notNull(),
  nisValueCents: integer("nis_value_cents").notNull(),
  rateLabel: text("rate_label").notNull(),
  reportDate: text("report_date").notNull(),
  note: text("note").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_cash_reports_date_created").on(table.reportDate, table.createdAt)]);
