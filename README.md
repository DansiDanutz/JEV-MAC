# JEV-MAC

Local-first Mac file organization, diagnostics, and reversible cleanup.

**Status: synthetic-tested local preview. The full goal and personal-data pilot remain open.**

The dashboard scans explicitly approved folders, identifies exact duplicate content,
reports storage and folder overlap, checks bounded local text references, previews Jev
metadata classification, and prepares recoverable quarantine or copy-organization plans.
History supports collision-safe restore. Nothing is scanned automatically.

## Run on macOS

Requires Node 24+ and Apple's command-line compiler tools. This Mac was tested with
Node 26.10.0; installation does not replace Node or install system tools.

```sh
npm ci
npm run build
npm start
```

Open `runtime/launch.html` to unlock the local dashboard, or double-click
`Start JEV-MAC.command` and keep its terminal open. Control-C stops that service.
The launcher can use the existing private `~/.jev-router.env` without copying its key.
Port selection is automatic and remembered; no claim is made that it was never used.
The old dashboard on port 54873 is not reused.

Start with **Create safe demo**, then **Scan**. Register personal folders only after
reviewing the [verification limits](docs/VERIFICATION.md). Quarantine keeps files on the
same volume and does **not** free disk space; permanent deletion is intentionally absent.
No system repair, cache purge, or backup deletion runs automatically.

## Verify and connect agents

```sh
npm test
npm run build
npm run test:e2e
npm run cli -- status
```

Browser tests use installed Google Chrome. [Agent setup](docs/AGENT-SETUP.md) covers CLI,
MCP stdio and the portable skill. Agents can inspect and prepare plans, but human-only
dashboard approval is required for uploads, apply and restore. Per-harness registrations
have not been changed or claimed tested.

See [the goal checkpoint](GOAL.md) and [verification ledger](docs/VERIFICATION.md) for
evidence and remaining gates. Runtime keys, logs, catalogs and generated binaries stay out of Git.

[Build plan](docs/PLAN.md) · [Research and reuse](docs/RESEARCH.md)

The dashboard will share one safety-controlled engine with a CLI and MCP server.
Jev suggests categories; deterministic checks and user approval control changes.
Claude Code, Codex, Kimi and GLM-backed clients will use the same constrained tools,
not separate unrestricted deletion scripts.

No personal files have been scanned, moved, uploaded or deleted by this project.
