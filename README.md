# Finance Assistant

Finance Assistant is an open-source app for reviewing household spending and budgets on your computer.

Import bank statement files, review transactions, and explore your income, expenses, recurring costs and category budgets. Start with the included demo data, then set up a separate workspace for your household.

Transactions come from files you provide. The app does not connect directly to your bank. Each workspace supports one household and one base currency: USD, EUR, GBP or ILS.

## What you can do

- Review spending, income and transaction history by month.
- Plan category budgets and recurring costs.
- See a daily spending allowance based on your recorded balance, income and spending plan.
- Explore merchant reports and distinguish purchases, refunds and transfers.
- Import CSV files with configurable columns and date formats. Some Israeli bank and credit-card XLSX layouts are also supported; see the [import guide](docs/IMPORTS.md).
- Back up and restore dashboard settings, budgets and cash reports.

## Download and requirements

Open the [releases page](https://github.com/dv85/finance-assistant/releases), download the `finance-assistant-<version>-source.zip` file listed under **Assets**, and extract it.

Open a terminal in the extracted folder containing this README and the `scripts/` directory. This is the **project root** used in the instructions below.

You will need:

- Python 3.12 with `venv` and `pip`.
- Node.js 24 and npm.
- A terminal and a text editor for the household configuration file.

The commands below use macOS/Linux shell syntax. End-to-end setup has been validated on macOS; Linux and Windows remain unverified. This is a source release: you install its dependencies and start the app from the terminal.

## Try the demo

The demo uses made-up transactions for the current month. In the project root, run:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python scripts/setup_local.py --demo
cd web
npm ci
npm run db:migrate:local
npm run dev
```

Keep that terminal running. Once the server is ready, open a second terminal in the project root and run:

```bash
.venv/bin/python scripts/run_integrity_harness.py
.venv/bin/python scripts/sync_local_ledger.py
```

These commands validate the records and load them into the dashboard. Open [http://127.0.0.1:4310](http://127.0.0.1:4310) to explore the demo.

Demo setup refuses to replace an existing household configuration or ledger. Use a separate fresh copy of the source when you are ready to import your own records.

## Set up your household

Extract a fresh copy of the source into a separate folder. In that folder's project root, create the Python environment and copy the example configuration:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
mkdir -p config
cp examples/household.example.json config/household.json
```

**Edit `config/household.json` before running setup for the first time:**

- Choose USD, EUR, GBP or ILS as the base currency. All imported amounts must use that currency; the app does not convert currencies.
- Give each bank, card or cash account a stable ID. The import examples use `checking`; replace it with your configured account ID when necessary.
- Set category budgets and the protected buffer: the amount you want to leave untouched.
- Supply a confirmed account balance and its date to support balance-based spending estimates. Without a confirmed balance, treat the allowance as incomplete. If you have multiple bank accounts, set `balance.accountId` to the account used for these estimates.
- Adjust the optional transaction-matching rules to suit your statement descriptions.

After saving the configuration, initialize the ledger and start the dashboard:

```bash
.venv/bin/python scripts/setup_local.py
cd web
npm ci
npm run db:migrate:local
npm run dev
```

Setup records the base currency in the ledger, even when it is empty. Keep it unchanged after initialization. To use another currency, create a separate fresh workspace and configure it before setup. Keep account IDs stable once you have imported transactions.

Leave the server running. In a second terminal at the project root, import your first statement using the steps below.

## Import and review a CSV statement

Place your CSV file at `Finance Imports/statement.csv`, or change `--input` in the commands below to its actual path.

Copy `examples/csv-mapping.example.json` to `config/csv-mapping.json`. Edit the mapping to match your file's column names, date format and amount conventions. The [import guide](docs/IMPORTS.md) explains mapping options, duplicate handling, installments and supported XLSX layouts.

First, preview the import. This does not apply transactions to the ledger:

```bash
.venv/bin/python scripts/convert_bank_exports.py \
  --format csv --input "Finance Imports/statement.csv" \
  --mapping config/csv-mapping.json --account checking
```

Open `outputs/latest-import-preview.json`. Review the account, dates, amounts, transaction types, categories and duplicate counts. Resolve errors and review every warning. Check that transfers and card statement payments are not counted as spending, and that refunds have the correct type.

Once you have reviewed a successful preview, apply it, validate the ledger and update the dashboard:

```bash
.venv/bin/python scripts/convert_bank_exports.py \
  --format csv --input "Finance Imports/statement.csv" \
  --mapping config/csv-mapping.json --account checking --apply
.venv/bin/python scripts/run_integrity_harness.py
.venv/bin/python scripts/sync_local_ledger.py
```

The sync command loads the validated records into the local dashboard and verifies their source hash, counts and totals. After it succeeds, open the dashboard and select the imported month to confirm your transactions are visible. An import is complete only after validation, sync and this final check all succeed.

Run a new preview after changing the input files, mapping or household configuration. A changed source, configuration, application code or ledger invalidates the previous preview or integrity report.

The included example CSV uses April 2025 dates. Select **April 2025** in the dashboard when trying that file; the demo generated by `--demo` uses the current month.

## Privacy and backups

The supported app runs on your computer at a local address. Keep the development server private to that computer; do not expose it through a tunnel or shared network. Hosted deployment is not covered by the local setup instructions.

Your configuration, ledger, statement files and local database contain private financial information. The app does not encrypt these files. Use your operating system's access controls and disk encryption, and keep private records out of public repositories, issues and screenshots.

Use **Settings → Data & backup** to export or restore dashboard settings, budgets and cash reports. Restore requires a complete supported backup exported by the app.

Dashboard backups do not replace backups of your financial records. Keep separate private backups of:

- `memory/`: your primary transaction ledger.
- `config/`: household settings and import mappings.
- Your original bank statement files, including those in `Finance Imports/`.

The `web/.wrangler/` directory holds the local database, including dashboard edits, and must also stay private. Do not publish or share the whole working folder after adding household data.

## Optional assistance with Codex

Codex can help configure a household, map statement columns and review import results. It is optional; the commands above can be run directly.

Open the project folder in Codex and start with a request such as:

> Help me set up my household using these local bank files. Inspect the headers, propose the CSV mapping, preview the import, and show me the review findings before applying it.

Project instructions for assistants are in [AGENTS.md](AGENTS.md). The [workflow guide](harness/README.md) describes import review, reconciliation and monthly close procedures.

## Development and contributions

Python handles statement imports, ledger validation and dashboard data preparation. The web app uses React on Vinext with a local Cloudflare D1 database. The primary ledger is `memory/ledger.json`; `outputs/latest-import.json` is its derived dashboard data. Dashboard edits are stored separately in the local database and survive ledger refreshes.

After setting up a demo or household, run the validation commands from the project root:

```bash
.venv/bin/python -m unittest discover -s scripts -p 'test_*.py'
cd web
npm test
npm run typecheck
npm run build
cd ..
.venv/bin/python scripts/run_integrity_harness.py --full
```

Tests use made-up fixtures and temporary folders. The integrity command also validates the workspace's ledger and writes a report under the private `outputs/` folder. The production build is checked during validation; start the supported local app with `npm run dev`.

See [contributing](CONTRIBUTING.md) for development guidelines and [security reporting](SECURITY.md) for reporting vulnerabilities. [Hosting notes](docs/HOSTING.md) describe the additional work needed to adapt the app for private hosting; hosted deployment remains unverified.

Source archives must be created with `scripts/package_release.py`, which exports only the reviewed `PUBLIC_FILES.json` allowlist and excludes private runtime data.

## License

Project code is licensed under the [GNU General Public License version 3 only](LICENSE), SPDX `GPL-3.0-only`. Dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
