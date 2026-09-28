# JEV analytics: scope and evidence

The dashboard's **JEV Analytics** page reads a fixed list of local sources only when
opened or explicitly refreshed, preserving validated router token receipts locally.
It never calls JEV, reads keys, executes feature
commands or changes routing configurations. The endpoint requires browser authentication;
the constrained agent token cannot access machine-wide analytics.

## Sources

- Router temporary `jev-claude/*.json`: recent per-session history, capped upstream
  at 20 decisions. The latest entry also appears in history and is counted once.
- Hermes default/profile `logs/jev-decisions.jsonl` and `logs/freellm-jev.jsonl`:
  decision counts and numeric usage where actually present. These logs may have
  no timestamps, no usage, shadow decisions or test traffic.
- JEV-MAC `jev-cache`: retained unique classification response usage; request
  attempts are separate from successful paid responses and cache hits.
- Known launchers, plugin/checkouts and skill paths: existence only, not service health.

Reads are bounded to 100 entries per checked directory and 4 MiB per file.
Files that are malformed, symlinked or oversized are not parsed. No raw prompts,
model outputs, reason strings or session credentials are returned by the collector.
The JSON must not be published as a public inventory. Personal records are never
committed to Git.

## Interpretation

Reported tokens are **JEV decision tokens**, not tokens consumed by the chosen
Codex/Claude/Hermes model. Missing receipts mean unknown usage, not free usage.
Temporary logs and partial retention cannot establish installation-to-date spend.
File creation timestamps would not reliably establish installation dates either.

The dashboard deliberately leaves baseline tokens and measured savings null.
Different model prices can save money without reducing tokens. Subscription quota
cannot be converted directly into cash savings. A fair benchmark needs matched
tasks, quality checks, downstream input/output/cache usage, retries and verified
prices. No paid benchmark was run and no fleet routing was enabled.

## Verification

Unit fixtures cover numeric validation, missing evidence, deduplication and prompt
exclusion. Browser fixtures cover the usage/savings distinction and manual refresh.
The normal project build, unit and browser gates must pass before release.

## Open gaps

- No complete historical provider ledger or no-JEV baseline.
- No project/session correlation across harnesses.
- Driver, microphone, subscription and credential health are not tested here.
- No inference that plugin presence means routing is currently enabled.
- New receipt adapters require a separate reviewed integration; no changes to peer
  agents' live runtime configurations were made.

## Durable tracking goal

Goal: retain valid JEV token receipts across restart and source-log expiry without
double-counting, preserving project attribution only when explicitly supplied.

The private `runtime/usage-receipts.sqlite` ledger stores IDs, source, a non-sensitive
project slug, timestamp, input tokens and output tokens. No prompt or response text.
Router receipts are captured on analytics refresh and labeled `unattributed`; no
project is guessed. New successful JEV-MAC classifier calls are recorded once and
tagged with approved source-folder IDs. Cache hits do not add another paid receipt.
Older cached responses remain partial evidence rather than fabricated request history.

Other integrations can explicitly import a JSON receipt with:
`npm run receipt:import -- /path/to/receipt.json`

```json
{"id":"unique-provider-request-id","source":"project-import","project":"my-project","occurredAt":"2026-09-28T00:00:00Z","inputTokens":100,"outputTokens":10}
```

Use JEV decision tokens only, not downstream model tokens. IDs must be stable and
unique across projects/providers; replaying an identical receipt is a no-op and
conflicting values are rejected. Do not import router/JEV-MAC calls captured by the
native adapters. Imports are labeled self-reported, not provider-verified. No
existing agent hooks, peer configurations or upstream packages are modified.
This is not continuous cross-harness capture: producers still need to emit receipts,
and router activity can be missed between manual refreshes.
