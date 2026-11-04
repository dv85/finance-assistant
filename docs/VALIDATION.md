# Release validation — v0.1.2, 2026-11-05

Validated with fabricated records on **macOS ARM64**, Python 3.12.14, Node.js v24.13.0 and npm 11.6.2. Linux, Windows and hosted deployment remain unverified.

## Release scope

- Ported the cobalt and neutral visual design to the local public app: shared controls and navigation, the Today allowance surface, monthly summary, forecast beside cash coverage, and expandable flexible-budget details.
- Preserved configured USD/EUR/GBP/ILS formatting, historical missing-balance handling and financial calculations. Forecast axis margins adapt to the rendered currency labels on narrow screens.
- Kept the local access boundary, import formats and database schema unchanged. The release includes the user-oriented README and its currency-before-initialization setup instructions.

## Dependency remediation

The existing Cloudflare development-tool chain resolved `undici` 7.29.1 and produced one high and three moderate affected-package findings. A pinned npm override selects MIT-licensed **Undici 7.30.1**. A clean `npm audit --json` reports **zero vulnerabilities across all severities** on 2026-11-05. No audit rules were suppressed and no force-fix or toolchain downgrade was used.

Direct dependency versions remain React 19.3.1, Vinext 1.3.0, Vite 8.3.5, Cloudflare Vite plugin 1.64.0 and Wrangler 4.151.3. The project-owned tinyglobby adapter and the patched fast-uri/fflate overrides remain in place; their tests pass. The dependency-license inventory reflects the final lockfile.

The audit is a registry result at validation time, not a guarantee about future advisories. Python dependency versions remain pinned and unchanged; this record does not claim a separate Python vulnerability audit.

## Fresh-install validation

The 103-file public allowlist was copied into five separate temporary workspaces: synthetic demo, USD, EUR, GBP and ILS. Each received a new Python virtual environment, npm installation and local database. No existing household ledger, configuration, credentials, dependency directory or database was reused.

- All five `npm ci` runs succeed without warnings, report zero known vulnerabilities and leave the lockfile byte-identical. Installed Undici is 7.30.1.
- Household configuration is created and edited before setup. Each synthetic CSV preview is reviewed before apply: five inserts, no duplicates, no errors and no warnings; income, expenses, refund and transfer types/directions are checked.
- The integrity harness passes **26 Python tests and 40 JavaScript tests** in each workspace. Full mode in the demo additionally passes TypeScript checking and the production build.
- Local database migrations pass in all five workspaces.
- Local snapshot sync activates only after reconciliation, and verifies source hash, entity counts and gross transaction amount in every workspace. The imported period is then checked in the browser.

The demo reconciles two accounts, five transactions, one observed balance and one import run (429950 cents in gross transaction amounts). Each CSV household reconciles two accounts, five transactions and one import run (416550 cents); the missing-balance fixture has no observation, and the other household fixtures have one.

Build tooling emits existing nonfatal source-map/chunking warnings. These do not prevent the production build or checks from completing.

## Browser and interaction checks

Playwright CLI checks use synthetic data only:

- Today, Budget, Commitments, Income, Activity and Settings at desktop, 390px and 320px widths; merchant reports are also checked.
- Allowance setup, preview/cancel, saving a changed buffer, reload persistence and restoration of the original synthetic value.
- Native disclosure keyboard interaction, visible focus, mobile navigation and the cobalt palette.
- All four base currencies in daily amounts, setup labels, previews, transaction lists and chart labels.
- Fresh balance, zero allowance, missing balance and stale balance states.
- April 2025 imported records with an absent closing balance still shown as an em dash; future months show a plan without a current daily recommendation or fabricated closing balance.
- No document-level horizontal overflow or chart-label clipping in tested viewports.
- Zero browser console errors and warnings across all five workspaces.

Screenshots and detailed logs are kept outside the publication set. Temporary browser sessions and loopback servers are closed after verification.

## Privacy, licensing and packaging

`PUBLIC_FILES.json` remains the explicit 103-file publication allowlist. Only source, documentation, schemas and synthetic fixtures are packaged. Runtime records, private configuration, raw exports, databases, dependency installations, generated reports, browser artifacts and Git metadata are excluded. Packaging rejects private paths, symlinks and unreviewed binary additions.

Manual privacy review and fully redacted local Gitleaks scans cover the exact source archive, staged content and outgoing Git history before publication. No repository content is uploaded to a scanning service. Final archive digest and scan receipts are recorded outside the publication set and in the GitHub release notes where appropriate.

Project code remains GPL-3.0-only. Third-party licenses retain their own terms; no third-party distributions are bundled in the source archive.
