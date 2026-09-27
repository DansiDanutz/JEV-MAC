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

## Tested client registrations

To rerun the full synthetic client acceptance check, use one of:

```sh
npm run test:harness -- codex
npm run test:harness -- claude
npm run test:harness -- kimi
```

These opt-in checks use the client's existing authentication and incur model usage.
Each creates an isolated service and synthetic root, asks the model to cancel a held
test job, scan twice, and preview organization and classification. Assertions inspect
actual service calls, completed jobs, pending plans, and unchanged source files.
The held job tests cancellation transport; it is not a large-file scan benchmark.
Private diagnostics remain in the printed temporary directory. The service stops afterward.
Kimi requires an already trusted workspace and temporarily creates `.kimi-code/mcp.json`;
the check refuses to overwrite an existing file and removes its own configuration on exit.
Codex and Claude use invocation-only MCP configuration. No harness check approves plans.

Set `JEV_MAC` to this checkout's absolute path in the examples below. Start the service
first and verify `npm run cli -- status` succeeds.

Codex CLI 0.157.0:

```sh
codex mcp add jev-mac -- "$JEV_MAC/node_modules/.bin/tsx" "$JEV_MAC/src/mcp.ts"
codex mcp get jev-mac
```

Claude Code 2.1.283 (local project scope):

```sh
claude mcp add --scope local jev-mac -- "$JEV_MAC/node_modules/.bin/tsx" "$JEV_MAC/src/mcp.ts"
claude mcp get jev-mac
```

Kimi Code 2.1.1 uses `.kimi-code/mcp.json` in the checkout. Review the command shown
by its workspace-trust prompt before enabling it:

```json
{
  "mcpServers": {
    "jev-mac": {
      "command": "/absolute/path/to/JEV-MAC/node_modules/.bin/tsx",
      "args": ["/absolute/path/to/JEV-MAC/src/mcp.ts"]
    }
  }
}
```

These registrations expose only the tools defined by `src/mcp.ts`. Remove a test
registration with `codex mcp remove jev-mac` or `claude mcp remove jev-mac`; remove
the Kimi JSON entry through `/mcp-config` or by editing that project file.

The portable skill is `skills/jev-mac/SKILL.md`; copy that folder into a selected
harness's skill directory only when requested. A GLM-backed client needs MCP support.
Codex, Claude Code and Kimi model-driven status calls have been verified; a GLM-backed
host has not been selected or tested.

The agent credential permits state, scan of approved roots, cancellation and plan/payload
previews. It deliberately cannot approve roots, transmit metadata, apply or restore.
This separation is application policy, not a sandbox against arbitrary processes running
as your macOS user. Such processes can already read your private local files.

Optional Jev credentials: set TYPESAFE_API_KEY/JEV_API_KEY in the service environment,
or set JEV_MAC_KEY_FILE to an existing chmod-600 env file containing JEV_API_KEY.
Never pass a key on the command line or commit it. No personal content is sent; even
filenames require approval of a payload preview. Ceiling: 20 requests/day, 20 files/request,
no retries. This is a request ceiling, not a guaranteed dollar budget.
