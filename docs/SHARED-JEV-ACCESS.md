# Shared, opt-in JEV access

Verified on this Mac: jev, jev-codex, jev-claude, codex, claude and kimi resolve
on PATH. Claude also has an existing jev-model-routing skill. No global model
configuration was changed during this setup and no paid calls were made.

The new jev-project-opt-in skill is linked into ~/.codex/skills and
~/.agents/skills. Its source is tracked under skills/jev-project-opt-in here.
Hosts that do not discover the shared skill directory can read the source
SKILL.md explicitly. New skills may require a new agent session to be listed.

Use: "Use jev-project-opt-in to assess routing for this project. Keep my current
model as default; show the data-sharing scope and cost controls before enabling."

This is shared guidance and access to existing commands, not a transparent
global API proxy. No automatic hooks, shell aliases, background API calls,
credential copies or changes to Codex/Claude/Kimi configuration were installed.
The OpenRouter pilot remains limited to the JEV-MAC synthetic test; real project
adapters still need project-specific implementation and verification.
