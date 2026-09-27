import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { startServer } from "../src/server.ts";
import type { Job } from "../src/core.ts";

// Opt-in: runs a real model session using the selected client's existing credentials.
const harness = process.argv[2];
if (!["codex", "claude", "kimi"].includes(harness))
  throw Error("Usage: npm run test:harness -- codex|claude|kimi");
const project = fileURLToPath(new URL("../", import.meta.url));
const base = await fs.mkdtemp("/private/tmp/jev-harness-smoke-");
const fixture = path.join(base, "fixture");
await fs.mkdir(fixture);
const original = "Synthetic harness acceptance fixture\n";
await fs.writeFile(path.join(fixture, "notes.txt"), original);
const app = await startServer({ dataDir: path.join(base, "data"), port: 0 });
const configPath = path.join(project, ".kimi-code", "mcp.json");
let ownsConfig = false;
let ownsConfigDir = false;
const calls: string[] = [];
app.server.on("request", (req, res) => {
  res.on("finish", () => {
    if (res.statusCode === 200 && req.url?.startsWith("/api/"))
      calls.push(req.url.split("?")[0]);
  });
});
try {
  const root = await app.engine.addRoot(fixture);
  // A held job makes cancellation verifiable independent of model/network latency.
  const held = app.engine.start("synthetic-harness-cancel", async (signal) => {
    if (!signal.aborted) await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true }));
    signal.throwIfAborted();
  });
  const server = {
    command: process.execPath,
    args: ["--import", path.join(project, "node_modules/tsx/dist/loader.mjs"), path.join(project, "src/mcp.ts")],
    env: { JEV_MAC_DATA_DIR: app.dataDir },
  };
  const prompt = `Run the JEV-MAC synthetic acceptance check using only jev_mac MCP tools.
Do not use shell, file tools, other servers or subagents. Do not apply, upload or restore.
1. Read status and cancel held job ${held.id}. Poll status until cancelled.
2. Scan approved root ${root.id}. Poll status until the scan completes.
3. From status find notes.txt, preview an organize plan for that file, then preview its classification metadata.
4. Scan the same root again and poll until complete. Read final status.
Report the two completed scans, cancelled job and pending plan. Stop after these steps.`;
  let args: string[];
  if (harness === "codex") {
    args = ["exec", "--ephemeral", "--ignore-user-config", "-s", "read-only", "-m", "gpt-5.6-sol",
      "-c", 'model_reasoning_effort="low"',
      "-c", `mcp_servers.jev-mac.command=${JSON.stringify(server.command)}`,
      "-c", `mcp_servers.jev-mac.args=${JSON.stringify(server.args)}`,
      "-c", `mcp_servers.jev-mac.env={JEV_MAC_DATA_DIR=${JSON.stringify(app.dataDir)}}`, prompt];
  } else if (harness === "claude") {
    args = ["-p", "--no-session-persistence", "--strict-mcp-config", "--tools", "",
      "--permission-mode", "dontAsk", "--allowedTools", "mcp__jev-mac__*",
      "--mcp-config", JSON.stringify({ mcpServers: { "jev-mac": server } }), "--", prompt];
  } else {
    try { await fs.mkdir(path.dirname(configPath)); ownsConfigDir = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    // Never replace a user's existing project registration.
    await fs.writeFile(configPath, JSON.stringify({ mcpServers: { "jev-mac": server } }), { flag: "wx", mode: 0o600 });
    ownsConfig = true;
    args = ["-p", prompt, "--output-format", "text"];
  }
  const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(harness, args, { cwd: project, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const collect = (chunk: Buffer) => { output = (output + chunk.toString()).slice(-16000); };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => child.kill("SIGTERM"), 180_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); resolve({ code, output }); });
  });
  // Keep raw client output private: it may contain local configuration diagnostics.
  await fs.writeFile(path.join(base, "client-output.txt"), result.output, { mode: 0o600 });
  assert.equal(result.code, 0, `Client failed; private diagnostics: ${base}`);
  const deadline = Date.now() + 10_000;
  while (app.engine.active.size && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  const state = app.engine.state();
  assert.equal(app.engine.get<Job>("job", held.id).status, "cancelled");
  assert.equal(state.jobs.filter((job) => job.type === "scan" && job.status === "complete").length, 2);
  assert.equal(state.plans.length, 1);
  assert.equal(state.plans[0].status, "pending");
  assert.equal(state.plans[0].items.length, 1);
  assert.equal(state.operations.length, 0);
  for (const route of ["state", "cancel", "scan", "plan", "classify-preview"])
    assert.ok(calls.includes(`/api/${route}`), `Missing successful ${route} call`);
  assert.deepEqual(await fs.readdir(fixture), ["notes.txt"]);
  assert.equal(await fs.readFile(path.join(fixture, "notes.txt"), "utf8"), original);
  console.log(JSON.stringify({ harness, passed: true, completedScans: 2, cancelledJobs: 1,
    pendingPlans: 1, operations: 0, successfulCalls: calls, diagnostics: base }, null, 2));
} catch (error) {
  console.error(`Harness check failed. Private synthetic diagnostics retained at ${base}`);
  throw error;
} finally {
  if (ownsConfig) await fs.unlink(configPath);
  if (ownsConfigDir) await fs.rmdir(path.dirname(configPath));
  await app.close();
}
