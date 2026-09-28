export const ROUTER_MODEL = "typesafe/jev-router";
export const PILOT_PROMPT = "What is 2+2? Reply with exactly 4. Do not use tools.";
export async function testOpenRouter(apiKey: string | undefined, transport: typeof fetch = fetch) {
  if (!apiKey?.trim()) throw Error("OpenRouter key is not configured in the server environment.");
  const started = Date.now();
  try {
    const response = await transport("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: ROUTER_MODEL, messages: [{ role: "user", content: PILOT_PROMPT }], max_tokens: 64, stream: false }),
    });
    if (!response.ok) throw Error("Provider rejected test");
    const reader = response.body?.getReader();
    if (!reader) throw Error("Missing response");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > 65536) { await reader.cancel(); throw Error("Oversized response"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (data.error || typeof data.choices?.[0]?.message?.content !== "string") throw Error("Invalid response");
    const count = (n: unknown) => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 ? n : null;
    const model = typeof data.model === "string" && /^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,99}$/.test(data.model) && !/secret|token|sk-/i.test(data.model) ? data.model : null;
    return { at: new Date().toISOString(), requestedModel: ROUTER_MODEL, reportedModel: model,
      correct: data.choices[0].message.content.trim() === "4", durationMs: Date.now() - started,
      inputTokens: count(data.usage?.prompt_tokens), outputTokens: count(data.usage?.completion_tokens),
      reportedCostUsd: typeof data.usage?.cost === "number" && Number.isFinite(data.usage.cost) && data.usage.cost >= 0 ? data.usage.cost : null };
  } catch { throw Error("OpenRouter test failed or timed out. No automatic retry; check provider access and billing privately."); }
}
