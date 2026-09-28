import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { startServer } from "../src/server.ts";
import { request } from "../src/client.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import http from "node:http";
import type { Engine, Job, Plan } from "../src/core.ts";

test("HTTP authentication, Origin policy, agent boundaries, durable lock and CLI transport", async () => {
  const dataDir = await fs.mkdtemp("/private/tmp/jev-http-test-");
  const app = await startServer({ dataDir, port: 0 });
  let demo = "";
  try {
    const post = async (
      route: string,
      body: unknown,
      token = app.browserToken,
      origin: string | undefined = app.origin,
    ) =>
      fetch(app.origin + route, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(origin ? { Origin: origin } : {}),
        },
        body: JSON.stringify(body),
      });
    assert.equal((await fetch(app.origin + "/api/state")).status, 401);
    assert.equal((await post("/api/connect-code", {}, "")).status, 401);
    assert.equal((await post("/api/connect-code", {}, app.agentToken)).status, 403);
    const grant = await (await post("/api/connect-code", {})).json() as { code: string };
    assert.equal((await post("/api/connect", { code: grant.code }, "", "https://evil.example")).status, 403);
    assert.equal((await post("/api/connect", { code: grant.code }, "", "")).status, 403);
    const connected = await post("/api/connect", { code: grant.code }, "");
    assert.equal(connected.status, 200);
    assert.equal((await connected.json() as { token: string }).token, app.browserToken);
    assert.equal((await post("/api/connect", { code: grant.code }, "")).status, 401);
    assert.equal((await fetch(app.origin + "/api/jev-analytics")).status, 401);
    assert.equal((await fetch(app.origin + "/api/jev-analytics", {
      headers: { Authorization: `Bearer ${app.agentToken}` },
    })).status, 403);
    assert.equal(
      (await post("/api/demo", {}, app.browserToken, "https://evil.example"))
        .status,
      403,
    );
    assert.equal(
      (await post("/api/demo", {}, app.browserToken, "")).status,
      403,
    );
    assert.equal((await post("/api/demo", {}, app.agentToken)).status, 403);
    assert.equal(
      (
        await post(
          "/api/apply",
          { planId: "x", confirmation: "x" },
          app.agentToken,
        )
      ).status,
      403,
    );
    assert.equal(
      (await post("/api/classify", { consent: true }, app.agentToken)).status,
      403,
    );
    const root = (await (await post("/api/demo", {})).json()) as {
      id: string;
      path: string;
    };
    demo = root.path;
    const scan = await post("/api/scan", { rootId: root.id }, app.agentToken);
    assert.equal(scan.status, 200);
    while (app.engine.active.size) await new Promise((r) => setTimeout(r, 20));
    const state = (await request("status", {}, dataDir)) as unknown as {
      summary: { files: number };
    };
    assert.equal(state.summary.files, 4);
    await assert.rejects(startServer({ dataDir, port: 0 }), /already running/);
    const config = JSON.parse(
      await fs.readFile(`${dataDir}/agent.json`, "utf8"),
    );
    assert.equal("browserToken" in config, false);
    assert.equal((await fs.stat(`${dataDir}/agent.json`)).mode & 0o077, 0);
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
    if (demo) await fs.rm(demo, { recursive: true, force: true });
  }
});

test("MCP scans, previews, cancels and rescans without mutation authority", async () => {
  const dataDir = await fs.mkdtemp("/private/tmp/jev-mcp-test-");
  const app = await startServer({ dataDir, port: 0 });
  const rootPath = `${dataDir}/fixture`;
  await fs.mkdir(rootPath);
  await fs.writeFile(`${rootPath}/notes.txt`, "Synthetic harness fixture\n");
  // Test setup supplies the human-approved root; MCP cannot register roots.
  const root = await app.engine.addRoot(rootPath);
  const client = new Client({ name: "jev-mac-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      "--import",
      fileURLToPath(
        new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url),
      ),
      fileURLToPath(new URL("../src/mcp.ts", import.meta.url)),
    ],
    env: {
      ...(Object.fromEntries(
        Object.entries(process.env).filter(([, v]) => v !== undefined),
      ) as Record<string, string>),
      JEV_MAC_DATA_DIR: dataDir,
    },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    async function call<T>(name: string, args: Record<string, unknown> = {}) {
      const result = await client.callTool({ name: `jev_mac_${name}`, arguments: args });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      const content = result.content as { type: string; text?: string }[];
      assert.equal(content[0]?.type, "text");
      return JSON.parse(content[0].text!) as T;
    }
    async function settled(id: string) {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const state = await call<ReturnType<Engine["state"]>>("status");
        const job = state.jobs.find((candidate) => candidate.id === id);
        if (job && !["running", "stopping"].includes(job.status)) return job;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw Error(`MCP job ${id} did not settle`);
    }
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      "jev_mac_cancel",
      "jev_mac_classify_preview",
      "jev_mac_plan",
      "jev_mac_scan",
      "jev_mac_status",
    ]);
    const result = await client.callTool({
      name: "jev_mac_status",
      arguments: {},
    });
    assert.equal(result.isError, undefined);
    assert.match(JSON.stringify(result), /duplicateGroups/);
    const denied = await client.callTool({
      name: "jev_mac_apply",
      arguments: {},
    });
    assert.equal(denied.isError, true);
    const scan = await call<Job>("scan", { rootId: root.id });
    assert.equal((await settled(scan.id)).status, "complete");
    const state = await call<ReturnType<Engine["state"]>>("status");
    assert.equal(state.summary.files, 1);
    const fileIds = state.files.map((file) => file.id);
    const plan = await call<Plan>("plan", { kind: "organize", fileIds });
    assert.equal(plan.status, "pending");
    assert.equal(plan.items.length, 1);
    await call("classify_preview", { fileIds });
    for (const name of ["roots", "apply", "restore", "classify"]) {
      const denied = await client.callTool({
        name: `jev_mac_${name}`, arguments: { planId: plan.id, confirmation: plan.id },
      });
      assert.equal(denied.isError, true, name);
    }
    // Hold real engine work so cancellation is deterministic across transport latency.
    const held = app.engine.start("fixture-cancellation", async (signal) => {
      if (!signal.aborted) await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }));
      signal.throwIfAborted();
    });
    await call("cancel", { jobId: held.id });
    assert.equal((await settled(held.id)).status, "cancelled");
    const rescan = await call<Job>("scan", { rootId: root.id });
    assert.equal((await settled(rescan.id)).status, "complete");
    const final = await call<ReturnType<Engine["state"]>>("status");
    assert.equal(final.operations.length, 0);
    assert.equal(final.plans.find((item) => item.id === plan.id)?.status, "pending");
    assert.equal(await fs.readFile(`${rootPath}/notes.txt`, "utf8"), "Synthetic harness fixture\n");
    assert.deepEqual(await fs.readdir(rootPath), ["notes.txt"]);
  } finally {
    await client.close();
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
test("occupied remembered port falls back to another loopback port", async () => {
  const dataDir = await fs.mkdtemp("/private/tmp/jev-port-test-");
  const occupied = http.createServer((_req, res) => res.end("occupied"));
  await new Promise<void>((resolve) =>
    occupied.listen(0, "127.0.0.1", resolve),
  );
  const busyPort = (occupied.address() as import("node:net").AddressInfo).port;
  await fs.writeFile(
    `${dataDir}/server.json`,
    JSON.stringify({ port: busyPort }),
  );
  let app: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    app = await startServer({ dataDir });
    assert.notEqual(Number(new URL(app.origin).port), busyPort);
    assert.equal(new URL(app.origin).hostname, "127.0.0.1");
  } finally {
    if (app) await app.close();
    await new Promise<void>((resolve) => occupied.close(() => resolve()));
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
