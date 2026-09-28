# JEV CLI validation — 2026-09-28

Scope: installed hermes-jev-skills 0.18.0; synthetic inputs only; user-approved
US$2 maximum for this test batch. This is a bounded smoke test, not proof of
production reliability across every harness. Existing credentials were used by
the CLI without exposing them. No routing pools, keys or live agents were changed.

## Results

| Capability | Evidence | Status |
| --- | --- | --- |
| doctor | TypeSafe key present in OS secret store; live JEV reachable, 345 ms; three routing tiers configured | Passed |
| setup-key | Help available; existing credential authenticated through doctor | Already configured; no key replacement tested |
| ask | Successful typed noul answer 0.96; 282 input + 20 output tokens; 326 ms | Passed live |
| triage | Synthetic outage classified now/problem; sent_to_jev true; 602 ms | Passed live |
| plan | status planned, not fallback; one open_url step for example.com; Gemini 2.5 Flash; 729 prompt + 31 completion tokens | Passed live; no browser action executed |
| memo | Shadow mode; one validated plan entry, 192 bytes | Storage passed; reuse intentionally not enabled |
| models | Five matching Gemini 2.5 Flash catalog entries with prices | Catalog passed; not all model endpoints tested |
| replay | One real JEV decision, routed true, simple/general, xiaomi/mimo-v2.6-flash, confidence 1.0; 374 ms | Routing passed; downstream model not invoked |
| spend | Explicit synthetic export processed with token counts and priced alternatives | Functional with sub-cent reporting caveat |
| dashboard | Launched on loopback ephemeral port; actual browser displayed profiles and routing controls | Read-only UI passed; mutation controls not exercised |

Upstream verification: `python3 -m unittest discover -s tests -q`:
`Ran 769 tests in 21.652s — OK`. ResourceWarnings were present; the suite did
not fail. Tests are not equivalent to real cross-harness sessions.

## Configuration and limitations

- Existing setup already supports these CLI tests; no replacement key required.
- Plan uses a separate text model, not JEV; its existing connection worked.
- Hermes dashboard reported 0 on, 0 shadow, 5 off. Installing a plugin does not
  activate routing. No existing fleet/profile settings were changed in this test.
- This does not prove Claude, Codex, Kimi or GLM are automatically routed.
- The dashboard smoke process was temporary, not a new persistent service.
- Spend rounds aggregate dollars to two decimals and its verdict treats savings
  of one cent or less as no cheaper candidate. Our $0.00055 synthetic row exposed
  this limitation. Never interpret displayed $0.00 as zero consumption.
- Replay initially received unsupported input_tokens/output_tokens fields and
  used its default eight-call token-loop assumptions. Its reported 60.3% cost
  reduction is NOT a measured saving. The committed replay fixture uses supported
  context_tokens/loop_calls fields; pricing still includes modeled output tokens.
- These standalone CLI calls do not establish complete JEV-MAC telemetry coverage.

## Cost

Only four small JEV operations (doctor, ask, triage, one-turn replay) and one
small text-model planning request were made. Estimated cost is well below US$0.01,
not a verified invoice total: not all commands expose provider token usage.
TypeSafe documents $0.042 per million input tokens, output free:
https://docs.typesafe.ai/models . The local model catalog lists Gemini 2.5 Flash
at $0.30/$2.50 per million input/output tokens. The replay cost comparison is
hypothetical downstream cost, not the price paid for this test.

## Reproduce deliberately

These commands are examples, not an automatic background test. Replay and plan
can make paid requests; obtain a fresh budget for another run.

```sh
jev doctor
jev memo stats
jev models list --search gemini-2.5-flash
jev spend --usage tests/fixtures/jev-smoke-usage.json --compare openrouter:google/gemini-2.5-flash-lite --json
jev replay tests/fixtures/jev-smoke-turns.jsonl --current openrouter:google/gemini-2.5-flash --only-provider openrouter --limit 1 --workers 1 --verbose
jev plan --timeout 15 'Open example.com in the browser'
```

Do not feed personal exports/messages into external services without reviewing
their scope. Do not clear the user's memo cache as part of testing.
