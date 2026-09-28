import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { receipt, ReceiptStore } from "../src/receipts.ts";
const example = { id: "example-1", source: "project-import", project: "demo", occurredAt: "2026-09-28T00:00:00Z", inputTokens: 10, outputTokens: 2 };
test("receipt ledger persists and imports are idempotent, conflicts never overwrite", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "jev-receipts-"));
  let store = new ReceiptStore(dir);
  try {
    assert.equal(store.add(example), true); assert.equal(store.add(example), false);
    assert.throws(() => store.add({ ...example, inputTokens: 100 }), /conflict/);
    store.close(); store = new ReceiptStore(dir);
    assert.equal(store.list().length, 1); assert.equal(store.list()[0].inputTokens, 10);
    assert.equal((await fs.stat(path.join(dir, "usage-receipts.sqlite"))).mode & 0o777, 0o600);
  } finally { store.close(); await fs.rm(dir, { recursive: true, force: true }); }
});
test("receipt schema rejects sensitive extras, paths, absent timestamps and invalid counts", () => {
  for (const change of [{ prompt: "private" }, { project: "/Users/person" }, { occurredAt: "invalid" }, { inputTokens: -1 }, { outputTokens: "2" }, { api_key: "private" }]) assert.throws(() => receipt({ ...example, ...change }));
});
