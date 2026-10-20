# Codex workflow guide

These procedures describe how to operate the local product with an assistant. They do not start background agents, scheduled jobs, or external integrations.

## Intake and import

Read `AGENTS.md` and `docs/IMPORTS.md`. Inspect file headers locally, identify the account and amount convention, and propose a mapping without copying private records into source files. Preview first. Review warnings, unknown categories, duplicate counts, refunds, transfers, and settlements before applying within the user's authorized scope.

An intake review should state the source format, period, configured account, currency, parsed/inserted/duplicate/error counts, and unresolved decisions. Keep detailed row evidence in ignored outputs.

## Reconciliation

After applying, run the integrity harness and require a successful result. Synchronize the local serving snapshot and verify source hash, entity counts, and total transaction amount. Confirm the imported period in the dashboard. Check that a bank settlement is not counted again as a card purchase and that refunds have the correct direction/type.

If staging or reconciliation fails, leave the previous active snapshot intact. Report the failed stage and do not claim completion.

## Spending and allowance review

State the period, last observed balance date, base currency, and missing evidence. Review income, actual spending, unpaid commitments, the protected buffer, and flexible budget remaining. Explain any difference between purchase, installment, and billing views. Keep projections distinct from observed transactions.

Use the existing dashboard calculation rather than inventing another allowance formula. If balance or income evidence is missing or stale, make that limitation visible. Suggest data/configuration corrections before drawing financial conclusions.

## Monthly close and backup

Reconcile all source exports for the period, clear unresolved duplicates or classifications, run validation and local sync, and review historical monthly totals. Export dashboard edits through Settings → Data & backup and keep separate private backups of ledger, configuration, and raw evidence. Save private reports under `outputs/`.

## Schemas and fixtures

`schemas/` contains the existing ledger and related record contracts. `data/` contains fabricated examples only. The public tests must work without any user's financial records.
