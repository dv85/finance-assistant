-- Clean schema only. No household seed records.

CREATE TABLE `accounts` (
	`snapshot_id` text NOT NULL,
	`source_id` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`currency` text DEFAULT 'ILS' NOT NULL,
	`provider` text,
	`card_last4` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY(`snapshot_id`, `source_id`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `data_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `app_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner_user_id` text,
	`active_snapshot_id` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE `balance_snapshots` (
	`snapshot_id` text NOT NULL,
	`source_id` text NOT NULL,
	`snapshot_date` text NOT NULL,
	`observed_balance_cents` integer NOT NULL,
	`currency` text DEFAULT 'ILS' NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY(`snapshot_id`, `source_id`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `data_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_balance_snapshots_snapshot_date` ON `balance_snapshots` (`snapshot_id`,`snapshot_date`);

CREATE TABLE `finance_users` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text,
	`role` text DEFAULT 'member' NOT NULL,
	`first_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE `import_runs` (
	`snapshot_id` text NOT NULL,
	`source_id` text NOT NULL,
	`label` text NOT NULL,
	`status` text NOT NULL,
	`imported_at` text,
	`transaction_count` integer DEFAULT 0 NOT NULL,
	`warning_count` integer DEFAULT 0 NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY(`snapshot_id`, `source_id`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `data_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_import_runs_snapshot_imported` ON `import_runs` (`snapshot_id`,`imported_at`);

CREATE TABLE `snapshot_state` (
	`snapshot_id` text PRIMARY KEY NOT NULL,
	`state_json` text NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `data_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `data_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`source_hash` text NOT NULL,
	`schema_version` text NOT NULL,
	`expected_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`activated_at` text
);

CREATE INDEX `idx_data_snapshots_status_created` ON `data_snapshots` (`status`,`created_at`);

CREATE TABLE `transactions` (
	`snapshot_id` text NOT NULL,
	`source_id` text NOT NULL,
	`fingerprint` text,
	`transaction_date` text NOT NULL,
	`billing_date` text,
	`reporting_date` text NOT NULL,
	`is_installment` integer DEFAULT false NOT NULL,
	`description` text NOT NULL,
	`merchant` text,
	`normalized_merchant_name` text,
	`merchant_description` text,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'ILS' NOT NULL,
	`direction` text NOT NULL,
	`type` text NOT NULL,
	`category` text NOT NULL,
	`cost_label` text,
	`source_label` text,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY(`snapshot_id`, `source_id`),
	FOREIGN KEY (`snapshot_id`) REFERENCES `data_snapshots`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE INDEX `idx_transactions_snapshot_reporting` ON `transactions` (`snapshot_id`,`reporting_date`);

CREATE INDEX `idx_transactions_snapshot_category_reporting` ON `transactions` (`snapshot_id`,`category`,`reporting_date`);

CREATE TABLE `budget_overrides` (
	`month` text NOT NULL,
	`category` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`month`, `category`)
);

CREATE INDEX `idx_budget_overrides_month` ON `budget_overrides` (`month`);

CREATE TABLE `cash_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`category` text NOT NULL,
	`currency` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`rate_to_nis` real NOT NULL,
	`nis_value_cents` integer NOT NULL,
	`rate_label` text NOT NULL,
	`report_date` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX `idx_cash_reports_date_created` ON `cash_reports` (`report_date`,`created_at`);

CREATE TABLE `household_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`currency` text,
	`opening_balance_cents` integer,
	`updated_by` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

PRAGMA optimize;

CREATE TABLE `household_members` (
	`email` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`added_by` text NOT NULL,
	`added_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE `category_settings` (
	`category` text PRIMARY KEY NOT NULL,
	`spending_type` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

ALTER TABLE `household_settings` ADD `buffer_target_cents` integer;

CREATE TABLE `recurring_plan_overrides` (
	`month` text NOT NULL,
	`recurring_cost_id` text NOT NULL,
	`amount_cents` integer NOT NULL,
	`included` integer DEFAULT true NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`month`, `recurring_cost_id`)
);

CREATE INDEX `idx_recurring_plan_overrides_month` ON `recurring_plan_overrides` (`month`);

CREATE TABLE `budget_catalog_versions` (
	`effective_from_month` text PRIMARY KEY NOT NULL,
	`catalog_json` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE `budget_month_plans` (
	`month` text PRIMARY KEY NOT NULL,
	`allocations_json` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE `budget_match_bindings` (
	`id` integer PRIMARY KEY NOT NULL,
	`bindings_json` text NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
