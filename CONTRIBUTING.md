# Contributing

Use Python 3.12 and Node 24 and follow the README setup instructions. Project contributions are made under GPL-3.0-only. Preserve third-party license notices.

Use synthetic fixtures. Never attach real statements, household ledgers, account identifiers, private screenshots, access tokens, or raw debug logs containing personal data to an issue or pull request.

For accounting or import changes, add a regression case that checks the financial invariant and explain the expected before/after behavior. Run the Python tests, `npm test`, `npm run typecheck`, and `npm run build`. For release work, use a synthetic initialized household and run `scripts/run_integrity_harness.py --full` plus the local sync workflow.

Keep data parsing separate from writes. Preserve preview/apply freshness checks, deterministic identities, explicit installment timing, and staged snapshot reconciliation. Document new formats and configuration changes.

Update `PUBLIC_FILES.json` when adding a public source file. Review every addition and run the public audit before packaging. Never replace the allowlist with an unrestricted archive of the working directory.
