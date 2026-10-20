# Optional private hosting

The supported release runs locally. Its production build deliberately does not authenticate users from request identity headers. Copying the local owner fallback into production would expose the household's data.

A private hosting adaptation needs all of the following before using real data:

- Your own hosting project, database, migrations, domain, and access policy.
- A trusted, verified authentication adapter that authenticates every request. Never trust caller-supplied forwarded or identity headers on a publicly reachable worker.
- Explicit owner provisioning and household membership checks before first public access; do not let the first arbitrary visitor claim ownership.
- A separately configured machine-to-machine sync credential stored outside the repository, if automated remote sync is desired.
- A remote sync client that preserves start/chunk/commit reconciliation, rollback of uncommitted staging, and verification of the active source hash and all expected totals.
- A fresh authentication, authorization, backup/restore, and privacy review using synthetic data.

The existing API shapes and D1 schema provide a starting point for a Sites/Cloudflare adaptation. No existing household site URL, project identifier, token, or service account is included here. The local sync client rejects non-loopback URLs and redirects; it cannot be repurposed as a remote publisher by changing its URL alone.

Production hosting and external publication require separate explicit authorization. Hosted deployment is not covered by the local release validation report.
