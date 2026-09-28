---
name: jev-project-opt-in
description: Set up or inspect optional JEV routing for a specific project without changing global agent models or silently sending project data to providers.
---

# Project-scoped JEV access

Shared availability is not permission to enable routing. Keep the current model
and provider until the user selects a project/workflow, approves the data sent
and authorizes the API budget. Loading this skill makes no paid calls.

## Choose the integration, not just the name

- `jev-codex` and `jev-claude` are installed CLI wrappers. Launch only when the
  user requests a routed CLI session in the named project. They are not the
  OpenRouter `typesafe/jev-router` endpoint, and do not change this desktop task.
- `jev route` returns advisory decisions; it does not reconfigure the calling
  harness. Inspect `jev --help` locally before choosing commands. Never substitute
  a routing decision for evidence that the chosen model executed successfully.
- OpenRouter `typesafe/jev-router` is an API provider using
  `https://openrouter.ai/api/v1/chat/completions`. For a project already using
  that API shape, propose an explicit provider option with the existing provider
  as the unchanged default. Do not rewrite global shell or harness configuration.
- The JEV-MAC Router Health pilot sends only a fixed synthetic test. Its source
  and constraints are in `/Users/davidai/ZCodeProject/JEV-MAC/docs/OPENROUTER-PILOT.md`.
  Read that document before using the pilot. It is not a general project adapter.
- Hermes has per-profile state. Inspect effective state before changing anything:
  the default state's routing switch is inherited by profiles lacking overrides.
  Preserve other profiles. No gateway restarts without authorization.

## Project integration gate

Read the project's AGENTS.md and current provider client. Confirm compatibility
with streaming, tools, response schemas, cancellation and reasoning parameters;
model catalog presence alone proves none of these. Keep direct/current-provider
execution available and preserve explicit model overrides. Missing key, timeout
or malformed output must be visible, not silently presented as a routed success.
Do not retry a paid operation automatically or fall back to a different paid
provider without an approved policy.

Keep credentials in the existing private server-side secret mechanism. Never
read, print, copy into project files, or ask for keys in chat. Do not forward
environment files, private code, paths or real prompts during synthetic testing.

Record requested versus reported model, usage, latency, failure and reported
cost separately from direct JEV decision usage. Missing cost is unknown. The
September 28 synthetic OpenRouter test reported a nonzero cost despite its zero
listing price. A previous test budget is not ongoing production authorization.

## Activation and disable

After approved synthetic tests, show the project-specific configuration diff and
rollback command before activating real data. Opt-in must be recorded in that
project's own supported configuration, not a global default. To disable, restore
the previous provider or start the native CLI without the JEV wrapper. A prompt
saying "disable JEV" is a request to perform/verify that configuration change,
not proof the current running harness can dynamically switch itself.

Kimi and GLM compatibility is unverified until their concrete host adapter is
tested. GLM is a model family, not one universal harness. Shared skill discovery
depends on each host; do not claim installation in a shared folder activates it
everywhere.
