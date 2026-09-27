import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { startServer } from "../src/server.ts";
import { request } from "../src/client.ts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import http from "node:http";

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

test("MCP stdio advertises only constrained tools and reads the same catalog", async () => {
  const dataDir = await fs.mkdtemp("/private/tmp/jev-mcp-test-");
  const app = await startServer({ dataDir, port: 0 });
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
