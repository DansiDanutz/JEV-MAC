import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { startServer } from "../src/server.ts";
import { pickFolder } from "../src/folder-picker.ts";

test("picker is human-only, cancellation has no side effect, and selecting never scans", async () => {
  const dir = await fs.mkdtemp("/private/tmp/jev-picker-test-");
  let calls = 0;
  const app = await startServer({
    dataDir: dir,
    port: 0,
    folderPicker: async () =>
      ++calls === 1 ? null : "/private/tmp/example-choice",
  });
  try {
    const post = (token: string) =>
      fetch(app.origin + "/api/folder-picker", {
        method: "POST",
        headers: {
          Origin: app.origin,
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ location: "other" }),
      });
    assert.equal((await post(app.agentToken)).status, 403);
    assert.equal(calls, 0);
    assert.deepEqual(await (await post(app.browserToken)).json(), {
      path: null,
      cancelled: true,
    });
    assert.deepEqual(await (await post(app.browserToken)).json(), {
      path: "/private/tmp/example-choice",
      cancelled: false,
    });
    assert.equal(app.engine.list("root").length, 0);
    assert.equal(app.engine.list("job").length, 0);
    await assert.rejects(pickFolder("bad; shell code"), /listed folder/);
  } finally {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
