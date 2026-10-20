# Finance Assistant contributor and operating instructions

This is the standalone public, local-first project. Its runtime data is private and must never enter version control, public reports, issue attachments, or release archives.

## Setup and scope

- Read `README.md`, `docs/IMPORTS.md`, and the relevant procedure in `harness/README.md`.
- Use Python 3.12 and Node 24. Install pinned dependencies into this project's `.venv` and `web/node_modules`.
- Work with one household and one base currency per workspace. Do not invent an exchange rate, future income, balance, category approval, or evidence.
- Only synthetic examples and tests may be committed. Never use a household's real records as test fixtures or screenshots.
- Keep the local server bound to loopback. Do not enable the local identity in production or trust incoming identity/forwarded headers.
- GPL-3.0-only is the project license. Preserve third-party notices and do not relabel dependency licenses.

## Import completion

1. Inspect local source headers and configure an explicit parser, account, and CSV mapping where needed.
2. Run `scripts/convert_bank_exports.py` without `--apply`.
3. Read `outputs/latest-import-preview.json`; resolve all errors and review warnings, types, categories, duplicate handling, and transfer/card settlement treatment.
4. Repeat with `--apply` only within the user's authorized scope. A stale or failed preview must be regenerated, never bypassed.
5. Run `.venv/bin/python scripts/run_integrity_harness.py` and require a passing report.
6. With the local dashboard running, run `.venv/bin/python scripts/sync_local_ledger.py`.
7. Verify the active source hash and every expected total, then confirm the imported period in the local dashboard.

Do not call the import complete after applying only the ledger. The serving copy must also be current. Never use a bundle produced before the final successful integrity run.

`memory/ledger.json` is durable truth. Snapshot sync must preserve separately stored dashboard edits. A failed staged import must roll back staging and retain the previous active snapshot.

## Reviews and reports

- State the data period, observed balance date, and missing evidence before discussing an allowance.
- Separate purchases, billed card installments, income, refunds, bank cash movements, and transfers.
- Show an auditable reconciliation. Do not infer a complete financing schedule from repeated amounts.
- Write private reports under `outputs/`; summarize findings without reproducing raw credentials or unnecessary personal details in chat.
- Ask before using an external account, uploading financial files, publishing data, or messaging anyone.

## Changes and releases

Run meaningful tests for import/accounting changes, then run the full integrity harness for release validation. Add parsers using synthetic fixtures and the extension guide.

Review changes to `PUBLIC_FILES.json` explicitly. Release packaging must use its allowlist and fail on private paths or symlinks. Run redacting secret scanning and manual privacy review on the exact source archive. Installing a scanner requires authorization; uploading to one is never implicit.

Do not stage, commit, push, create a public repository, change visibility, or rewrite existing history without explicit authorization and an exact safe target.
