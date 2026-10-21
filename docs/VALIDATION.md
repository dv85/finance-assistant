# Release validation — 2026-10-21

Validated with fabricated data on macOS arm64, Python 3.12.14 and Node.js 24.13.0. Linux, Windows and hosted deployment remain unverified.

## Review fixes

- Backup restore requires a complete supported v5 export. Unknown versions, unrelated JSON, missing sections and malformed containers fail before any replacement write. Complete empty exports and nullable defaults remain supported.
- Allowance balances use the configured account, or the only bank account when selection is unambiguous. Other bank/card observations cannot silently replace it. Same-date configuration corrections are applied idempotently.
- Installment grouping retains purchase references after removing ordinal text. Derived plan IDs are regenerated so previously merged purchases split correctly. Python-to-JavaScript tests preserve both purchases and their totals.

## Dependencies

The pinned stack uses React 19.3.1, Vinext 1.3.0, Vite 8.3.5, Cloudflare Vite plugin 1.64.0 and Wrangler 4.151.3. Unused drizzle-kit and the explicit emnapi runtime dependency were removed. Patched transitive versions are pinned in npm overrides.

The unpatched braces dependency is removed through a project-owned tinyglobby adapter for the build tool's single fast-glob call. Normal matching and excessive nesting have regression tests. See THIRD_PARTY_NOTICES.md for the override rationale and maintenance boundary. The dependency license inventory was refreshed from the final lockfile.

A fresh `npm audit --json` reports zero vulnerabilities across all severities. No audit rules were suppressed. This records the registry result at validation time, rather than a guarantee about future advisories.

## Automated validation

The source-only allowlist was copied into a fresh temporary directory without the original ledger, configuration, database, credentials, virtual environment or node_modules. Pinned Python installation and a clean npm installation succeeded.

- Python unittest discovery: 26 passed.
- JavaScript tests: 40 passed, none skipped.
- TypeScript checking and production build: passed.
- Full integrity harness: passed in the source checkout and isolated installation.
- New migration: 17 empty application tables.
- Local snapshot: activated with matching source hash, entity counts and transaction amount.
- HTTP regression checks: 43 passed, including rejection of unrelated/partial backups without loss of edits, valid backup restoration, nullable defaults, untrusted request rejection, staging reconciliation failure and rollback.
- Browser smoke check: dashboard and budget views load with synthetic data.

Build tooling emits source-map warnings; they do not prevent the checks or production build from passing. Hosted authentication is deliberately unsupported by this local release.

## Privacy and packaging

Only the explicitly reviewed PUBLIC_FILES.json allowlist is packaged. The additions are the backup envelope validator and tests, plus the project-owned glob adapter and tests. Runtime data, local databases, reports, logs, screenshots, credentials, installed dependencies and Git metadata remain excluded.

Dedicated secret scanning uses the previously checksum-verified Gitleaks 8.30.1 executable with full redaction and default rules. Source files, the extracted final archive and committed history are scanned locally. The final digest and scan results are recorded outside the publication set.

The project remains GPL-3.0-only. This verification does not authorize a public release or a visibility change.
