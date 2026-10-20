# Security reporting

Do not post credentials, bank files, personal ledger data, or a working exploit against a real household in a public issue.

Use GitHub private vulnerability reporting if the published repository enables it. Otherwise ask the maintainer for a private reporting channel before sending sensitive details. Provide a minimal synthetic reproduction, affected version, impact, and proposed mitigation if available.

This release is a loopback-only local application for trusted users of one computer. It does not implement remote multi-user authentication or encryption at rest. Do not expose its development server to a shared network or tunnel.

Keep household data and credentials outside version control. A `.gitignore` rule does not remove data already committed to history. If a credential is exposed, handle revocation separately; deleting a file alone is not sufficient remediation.
