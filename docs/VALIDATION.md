# Release validation — 2026-10-20

Validated on macOS arm64 with Python 3.12.14 and Node.js 24.13.0. All operating data used for the final validation was synthetic.

## Installation and automated checks

A fresh temporary source export was populated only from `PUBLIC_FILES.json`, with no parent workspace files, virtualenv, node_modules, database, credentials, or ledger copied into it. New Python and npm installations succeeded:

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
cd web
npm ci --no-audit --no-fund
cd ..
.venv/bin/python scripts/setup_local.py --demo
.venv/bin/python scripts/run_integrity_harness.py --full
```

The frozen final source was also revalidated in that isolated installation. Results:

| Check | Result |
| --- | --- |
| Python unittest discovery | 23 passed |
| `npm test` | 34 passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed |
| Ledger schema, identities, derived state, snapshot reconciliation | Passed |
| New migration produces 17 empty application tables | Passed |
| Public manifest rejects private paths, traversal, missing files, and symlinks | Passed |

Tests cover malformed CSV, explicit date/amount conventions, account/currency mismatches, duplicate imports, identical unreferenced purchases, refunds, transfers, card settlements, explicit installments, missing installment counts, XLSX running-balance reconciliation, stale previews, setup preservation, and release scope.

Additional regressions verify that received income is counted once, refunds reduce category spending, and missing historical closing balances are distinguished from observed zero balances.

## Local end-to-end checks

The documented preview/review/apply sequence succeeded for the synthetic CSV example. After a passing full integrity run:

```bash
cd web
npm run db:migrate:local
npm run dev
```

In another terminal, from the root:

```bash
.venv/bin/python scripts/sync_local_ledger.py
```

The local snapshot activated and its source hash, all entity counts, and aggregate transaction amount matched the bundle. A deliberately mismatched staging commit was rejected without changing the prior active snapshot, and staging cleanup succeeded.

Fourteen local HTTP checks passed, covering served periods, reconciliation, staging rejection, budget edits, base-currency cash reports, backup/restore including nullable settings, cross-origin spoof rejection, and preservation of dashboard edits through snapshot replacement. No production service or credential was used.

## Browser checks

Playwright verified the local dashboard, selected the historical imported period, and inspected desktop and 390 × 844 mobile layouts. No horizontal overflow or mismatched currency label was found. Missing historical balance evidence is displayed as unavailable. The final page load produced no application console errors. Local screenshots contain synthetic data and are excluded from the source archive.

## Privacy and release scope

The source migration was manually reviewed and historical household seed rows were removed. A regression now requires an empty fresh database, and the public audit rejects data-changing statements in release SQL. Private records, source exports, reports, screenshots, hosting configuration, Git history, dependency installations, and local databases are absent from the public allowlist.

The release uses the full GNU GPL version 3 text and `GPL-3.0-only` package metadata. Third-party license metadata is retained separately. Only a reviewed source allowlist is packaged; the full working directory must never be archived for publication after adding household data.

Dedicated scanning uses the temporary, checksum-verified Gitleaks 8.30.1 executable with full redaction, default rules, no suppression annotations, and local-only processing. The final archive and its extracted source are scanned after packaging; the accompanying release receipt records the final digest and scan results.

## Limits of validation

- macOS arm64 was exercised. Linux and Windows were not exercised in this run.
- Hosted authentication/deployment is deliberately outside the supported local release and was not validated.
- Vinext is pinned to a beta version; runtime upgrades require repeating these checks.
- Dependency metadata is an inventory, not a determination of every downstream redistribution's obligations.
- No Git commit, GitHub repository creation, push, or visibility change is part of preparation.
