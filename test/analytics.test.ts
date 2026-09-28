import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { collectAnalytics, summarize } from "../src/analytics.ts";
test("analytics counts valid receipts and omits private content", () => {
  const r = summarize("test", "fixture", [{ prompt: "PRIVATE", model: "gpt-6-luna", usage: { input_tokens: 1597, output_tokens: 170 } }, { usage: { input_tokens: -1, output_tokens: 2 } }, { usage: { input_tokens: "12", output_tokens: 2 } }]);
  assert.equal(r.input, 1597); assert.equal(r.output, 170); assert.equal(r.metered, 1);
  assert.ok(!JSON.stringify(r).includes("PRIVATE"));
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
    const result = await collectAnalytics({ home: root, temp: root });
    assert.equal(result.totalInput, 12); assert.equal(result.totalOutput, 3);
    assert.equal(result.meteredRecords, 1); assert.equal(result.measuredSavings, null);
    assert.ok(result.sources[0].warnings.length > 1);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
