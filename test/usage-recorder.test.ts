import { test } from "node:test";
import assert from "node:assert/strict";
import { startUsageRecorder } from "../src/usage-recorder.ts";

test("usage recorder captures automatically, never overlaps and closes cleanly", async () => {
  let calls = 0;
  let release!: () => void;
  const recorder = startUsageRecorder(async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); }, 100_000);
  await Promise.resolve();
  const first = recorder.capture(), second = recorder.capture();
  assert.equal(first, second); assert.equal(calls, 1);
  release(); await first;
  assert.ok(recorder.status().lastCompletedAt);
  recorder.setEnabled(false); await recorder.capture(); assert.equal(calls, 1);
  await recorder.close(); await recorder.capture(); assert.equal(calls, 1);
});
test("collector errors are sanitized and a later capture recovers", async () => {
  let fail = true;
  const recorder = startUsageRecorder(async () => { if (fail) throw Error("PRIVATE SECRET"); }, 100_000);
  await recorder.capture();
  assert.ok(recorder.status().lastError);
  assert.ok(!JSON.stringify(recorder.status()).includes("PRIVATE"));
  fail = false; await recorder.capture(); assert.equal(recorder.status().lastError, null);
  await recorder.close();
});
