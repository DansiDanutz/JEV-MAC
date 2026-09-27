---
name: jev-mac
description: Inspect approved Mac folders, review duplicate and Doctor findings, and prepare reversible organization or cleanup plans using the local JEV-MAC service.
---

# JEV-MAC

Use the installed `jev_mac_*` MCP tools, or this repository's CLI:
`npm run cli -- status` and `npm run cli -- help`.
The service must already be running. Read its status to obtain approved root IDs and
current file IDs; do not invent IDs or register a broader folder through shell commands.

Scan an approved root, poll status, then explain evidence before preparing a plan.
An exact hash match is duplicate content, not permission to discard a path. Repository
assets, backups and possible references require additional review. Jev supplies metadata
categories, not proof that a file is unused or safe to delete.

Plans are previews. Direct the user to Review / Plans in their local dashboard to approve
the exact item list. Metadata preview is not upload consent. Never read browser session
credentials or call human-only routes to bypass these gates. Apply, upload and restore
remain human actions in the dashboard. Quarantine is reversible and does not free space.

Use cancel for an active job; wait until status is terminal before starting another.
After errors, inspect status/history. Do not retry file mutations through raw shell tools.
Do not claim compatibility with an untested client; GLM access depends on its host harness.
