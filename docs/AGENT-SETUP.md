# Agent connection

Start the built service with `npm start` from this checkout. It writes private local
runtime files (ignored by Git). Open `runtime/launch.html` in a browser to unlock the UI.
Do not share this file: it holds a short-lived dashboard session credential.

CLI: `npm run cli -- status`; `npm run cli -- help` lists commands and arguments.

MCP stdio configuration template (replace the checkout path; do not include API keys):

```json
{
  "mcpServers": {
    "jev-mac": {
      "command": "/absolute/path/to/node",
      "args": ["--import", "/absolute/path/to/JEV-MAC/node_modules/tsx/dist/loader.mjs", "/absolute/path/to/JEV-MAC/src/mcp.ts"]
    }
  }
}
```

Alternatively use the checkout's `node_modules/.bin/tsx` executable with `src/mcp.ts`
as an absolute argument. Use your client's documented MCP registration UI/command;
this project does not modify Claude, Codex or Kimi configuration automatically.
Codex uses its own configuration shape, so do not paste the JSON into TOML directly.

The portable skill is `skills/jev-mac/SKILL.md`; copy that folder into a selected
harness's skill directory only when requested. A GLM-backed client needs MCP support.
Transport tests establish protocol compatibility, not successful registration in every app.

The agent credential permits state, scan of approved roots, cancellation and plan/payload
previews. It deliberately cannot approve roots, transmit metadata, apply or restore.
This separation is application policy, not a sandbox against arbitrary processes running
as your macOS user. Such processes can already read your private local files.

Optional Jev credentials: set TYPESAFE_API_KEY/JEV_API_KEY in the service environment,
or set JEV_MAC_KEY_FILE to an existing chmod-600 env file containing JEV_API_KEY.
Never pass a key on the command line or commit it. No personal content is sent; even
filenames require approval of a payload preview. Ceiling: 20 requests/day, 20 files/request,
no retries. This is a request ceiling, not a guaranteed dollar budget.
