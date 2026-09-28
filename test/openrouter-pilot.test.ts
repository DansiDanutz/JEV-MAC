import { test } from "node:test";
import assert from "node:assert/strict";
import { testOpenRouter } from "../src/openrouter-pilot.ts";
test("pilot uses fixed synthetic input and retains only numeric evidence", async () => {
  const transport = (async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    assert.equal(body.model, "typesafe/jev-router"); assert.equal(body.max_tokens, 64);
    assert.equal(init.redirect, "error"); assert.equal(body.tools, undefined);
    return new Response(JSON.stringify({ model: "example/model", choices: [{ message: { content: "4" } }], usage: { prompt_tokens: 8, completion_tokens: 1, cost: 0 } }));
  }) as typeof fetch;
  const result = await testOpenRouter("fixture-only", transport);
  assert.equal(result.correct, true); assert.equal(result.reportedCostUsd, 0);
  assert.equal(result.inputTokens, 8); assert.ok(!JSON.stringify(result).includes("fixture-only"));
});
test("missing usage is unknown, malformed and provider errors sanitized", async () => {
  const result = await testOpenRouter("fixture", (async () => new Response(JSON.stringify({ choices: [{ message: { content: "5" } }] }))) as typeof fetch);
  assert.equal(result.correct, false); assert.equal(result.inputTokens, null); assert.equal(result.reportedCostUsd, null);
  await assert.rejects(testOpenRouter("fixture", (async () => new Response("private error", { status: 401 })) as typeof fetch), /test failed/);
  await assert.rejects(testOpenRouter(undefined), /not configured/);
});
