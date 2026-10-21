# Finance Assistant

A local household dashboard and a Codex-guided workflow for importing bank exports, reconciling a durable ledger, and reviewing spending and budgets.

The dashboard includes a daily spending allowance, category budgets, recurring commitments, income, transaction history, merchant reports, and local backups. Codex follows the instructions in `AGENTS.md`; the agent workflows are instructions, not an autonomous agent service.

This first release runs on your computer. It needs no bank login, paid API key, Google Sheet, Sites account, or production credential. Imports use files you supply. The code is licensed under **GPL-3.0-only**; dependencies retain their own licenses.

## Requirements

- Python 3.12 with `venv` and `pip`.
- Node.js 24 and npm.
- macOS or Linux. Windows-specific paths exist in the integration test, but Windows has not been validated.
- Codex is optional for running the app and useful for guided setup, mapping exports, and reviewing imports.

## Start with synthetic demo data

From the project root:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python scripts/setup_local.py --demo
cd web
npm ci
npm run db:migrate:local
npm run dev
```

Keep that terminal running. In a second terminal, from the project root:

```bash
.venv/bin/python scripts/run_integrity_harness.py
.venv/bin/python scripts/sync_local_ledger.py
```

Open [the local dashboard](http://127.0.0.1:4310). Demo records are fabricated for the current month. `--demo` refuses to replace any existing household configuration or ledger.

## Start your own household

Use a separate fresh copy of the source for real data, then repeat the installation steps with `scripts/setup_local.py` instead of `--demo`. Edit the resulting ignored `config/household.json` before importing:

- Choose USD, EUR, GBP, or ILS as your single base currency.
- Give each bank, card, or cash account a stable id.
- Set category budgets, the protected buffer, and optional matching rules.
- Supply an observed balance with its date and account id if you want balance-based estimates. Without one, treat the allowance as incomplete until you provide a balance.

The configured balance account selects which account feeds the allowance. Only that account's observations are considered; a newer observation from another bank or card cannot replace it. With one bank account, its imported balances are selected automatically. With multiple bank accounts, configure `balance.accountId` explicitly. A corrected configured amount on the same date replaces the previous value; a newer observation for the selected account still takes precedence.

Rules run in file order; the first matching `contains` rule supplies defaults for type, category, and readable merchant name. Explicit CSV type/category columns take priority. Account ids and base currency must remain stable once you have transactions. Currency changes do not convert money and are rejected for an existing ledger.

The CSV examples use fixed historical dates so they remain reproducible. Select their month in the dashboard; your own exports retain their actual dates.

## Import CSV files

Copy `examples/csv-mapping.example.json` into your ignored `config/` folder and change the header names and conventions to match your file. See [the import guide](docs/IMPORTS.md) for debit/credit columns, installments, duplicate handling, and supported XLSX layouts.

```bash
.venv/bin/python scripts/convert_bank_exports.py \
  --format csv --input "Finance Imports/statement.csv" \
  --mapping config/csv-mapping.json --account checking
```

Read `outputs/latest-import-preview.json`. Review types, categories, amounts, account assignments, warnings, and every error. In particular, distinguish card statement payments and transfers from spending. Then repeat the same command with `--apply`:

```bash
.venv/bin/python scripts/convert_bank_exports.py \
  --format csv --input "Finance Imports/statement.csv" \
  --mapping config/csv-mapping.json --account checking --apply
.venv/bin/python scripts/run_integrity_harness.py
.venv/bin/python scripts/sync_local_ledger.py
```

An import is complete only after the local snapshot has activated, its hash and totals have been verified, and the imported period is visible in the dashboard. A changed source, mapping, configuration, code, or ledger invalidates its preview or integrity report.

## Use with Codex

Open this project folder in Codex. Start with a request such as:

> Help me set up my household using these local bank files. Inspect the headers, propose the CSV mapping, preview the import, and show me the review findings before applying it.

Codex must follow `AGENTS.md`. Reusable procedures live in [the workflow guide](harness/README.md). No Basecamp, Drive, Sites, or other connected account is required. Connecting or publishing to another service is a separate choice.

## Data and architecture

- `memory/ledger.json` is the durable local source of truth.
- `outputs/latest-import.json` is its derived dashboard state.
- Python handles parsing, preview/apply, validation, and snapshot construction.
- `web/` contains React on Vinext and a local Cloudflare D1 serving database.
- Snapshot imports use start/chunk/commit and reconcile counts and amounts before activation. A failed staging import leaves the previous active snapshot available.
- Dashboard edits to budgets, settings, and cash reports are stored separately in D1 and survive ledger refreshes.

The local server binds to loopback. The local owner identity is enabled only by `npm run dev`; production builds fail closed. Do not expose the development server through a tunnel or shared network. Files and the local database are not encrypted by this app; use your operating system's access controls and disk encryption.

Use Settings → Data & backup to export or restore dashboard edits. This does not replace the ledger. Keep separate private backups of `memory/`, `config/`, and your source files as well. The `web/.wrangler/` directory contains the local serving database and must stay private.

Restore accepts complete `cashflow-repair-shared-state/v5` exports. Unsupported versions, unrelated JSON, and missing sections are rejected before changing dashboard data.

## Validation

```bash
.venv/bin/python -m unittest discover -s scripts -p 'test_*.py'
cd web
npm test
npm run typecheck
npm run build
cd ..
.venv/bin/python scripts/run_integrity_harness.py --full
```

Tests use synthetic fixtures and temporary folders. The integrity command also validates your private local ledger and writes an ignored report. Build output is for validation; the supported local entry point is `npm run dev`.

## Release boundaries

This is a single-household, single-base-currency local release. It does not provide bank connectivity, automatic FX, a hosted authentication provider, or multi-household SaaS. Existing Israeli XLSX layouts have synthetic regression tests; other layouts should use an explicit CSV mapping or a new parser.

[Optional hosting notes](docs/HOSTING.md) describe the boundary for adapting it to a private site. Hosted deployment is not a verified one-command feature of this release.

To create a source archive, use `scripts/package_release.py`. It exports only the reviewed `PUBLIC_FILES.json` allowlist. Never publish the whole working folder after adding household data.

## License and contributions

Project code: [GNU General Public License version 3 only](LICENSE), SPDX `GPL-3.0-only`. See [third-party notices](THIRD_PARTY_NOTICES.md), [contributing](CONTRIBUTING.md), and [security reporting](SECURITY.md).
