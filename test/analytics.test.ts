import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectAnalytics, summarize } from "../src/analytics.ts";
import { ReceiptStore } from "../src/receipts.ts";
test("analytics counts valid receipts and omits private content", () => {
  const r = summarize("test", "fixture", [{ prompt: "PRIVATE", model: "gpt-6-luna", usage: { input_tokens: 1597, output_tokens: 170 } }, { usage: { input_tokens: -1, output_tokens: 2 } }, { usage: { input_tokens: "12", output_tokens: 2 } }]);
  assert.equal(r.input, 1597); assert.equal(r.output, 170); assert.equal(r.metered, 1);
  assert.ok(!JSON.stringify(r).includes("PRIVATE"));
});
test("harness attribution is conservative and undated receipts remain counted", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jev-harness-test-"));
  const store = new ReceiptStore(path.join(root, "ledger"));
  try {
    await fs.mkdir(path.join(root, "jev-claude"));
    const dated = { at: 1790466997725, model: "example-model", usage: { input_tokens: 10, output_tokens: 2 } };
    await fs.writeFile(path.join(root, "jev-claude", "codex-123.json"), JSON.stringify(dated));
    await fs.writeFile(path.join(root, "jev-claude", "unknown.json"), JSON.stringify({ usage: { input_tokens: 3, output_tokens: 1 } }));
    const report = await collectAnalytics({ home: root, temp: root, store });
    assert.equal(report.totalInput, 13);
    assert.equal(report.harnesses.find(h => h.name === "Codex")?.input, 10);
    assert.equal(report.harnesses.find(h => h.name === "Kimi")?.records, 0);
    assert.equal(report.daily["2026-09-26"].input, 10);
    assert.equal((await collectAnalytics({ home: root, temp: root, store })).totalInput, 13);
    await fs.unlink(path.join(root, "jev-claude", "codex-123.json"));
    const retained = await collectAnalytics({ home: root, temp: root, store });
    assert.equal(retained.harnesses.find(h => h.name === "Codex")?.input, 10);
    assert.equal(retained.harnesses.find(h => h.name === "Codex")?.models["example-model"], 1);
    assert.equal(retained.receiptCoverage.harnessAttributed, 1);
  } finally { store.close(); await fs.rm(root, { recursive: true, force: true }); }
});
test("analytics reports gaps and deduplicates session history", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "jev-analytics-test-"));
  try {
    const empty = await collectAnalytics({ home: root, temp: root });
    assert.equal(empty.meteredRecords, 0); assert.equal(empty.baselineTokens, null);
    await fs.mkdir(path.join(root, "jev-claude"));
    const row = { at: 1790466997725, model: "example-model", usage: { input_tokens: 12, output_tokens: 3 } };
    await fs.writeFile(path.join(root, "jev-claude", "session.json"), JSON.stringify({ ...row, history: [row, row] }));
    await fs.writeFile(path.join(root, "jev-claude", "broken.json"), "{");
    const store = new ReceiptStore(path.join(root, "ledger"));
    const result = await collectAnalytics({ home: root, temp: root, store });
    assert.equal(result.totalInput, 12); assert.equal(result.totalOutput, 3);
    assert.equal(result.meteredRecords, 1); assert.equal(result.measuredSavings, null);
    assert.ok(result.sources[0].warnings.length > 1);
    await collectAnalytics({ home: root, temp: root, store });
    assert.equal(store.list().length, 1);
    await fs.unlink(path.join(root, "jev-claude", "session.json"));
    const retained = await collectAnalytics({ home: root, temp: root, store });
    assert.equal(retained.totalInput, 12); assert.equal(retained.totalOutput, 3);
    store.add({ id: "project-1", source: "project-import", project: "example", occurredAt: "2026-09-28T00:00:00Z", inputTokens: 20, outputTokens: 2 });
    const imported = await collectAnalytics({ home: root, temp: root, store });
    assert.equal(imported.totalInput, 32);
    assert.ok(imported.sources.some(s => s.name === "Project: example"));
    store.add({ id: "native-1", source: "jev-mac", project: "root-demo", occurredAt: "2026-09-28T00:00:00Z", inputTokens: 40, outputTokens: 4 });
    const cached = await collectAnalytics({ home: root, temp: root, store, cached: [{ receiptId: "native-1", output: { usage: { input_tokens: 40, output_tokens: 4 } } }] });
    assert.equal(cached.totalInput, 72);
    assert.equal(cached.totalOutput, 9);
    store.close();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
