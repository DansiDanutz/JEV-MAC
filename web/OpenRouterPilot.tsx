import React, { useState, useEffect } from "react";
export function OpenRouterPilot({ request }: { request: <T>(path: string, init?: RequestInit) => Promise<T> }) {
  const [status, setStatus] = useState<any>(null), [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function refresh() { try { setStatus(await request("/api/openrouter-pilot")); } catch { setError("Pilot status unavailable. The server may need updating."); } }
  useEffect(() => { void refresh(); }, [request]);
  async function run() {
    setBusy(true); setError("");
    try { await request("/api/openrouter-pilot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ consent }) }); }
    catch { setError("Test did not complete. Check configuration or daily limit; no automatic retry."); }
    finally { setBusy(false); setConsent(false); await refresh(); }
  }
  return <section className="card openrouter-pilot"><h2>OpenRouter JEV pilot — opt-in</h2><p>Experimental API provider, not the installed CLI router. Does not switch your agents or authorize file actions.</p>
    {error && <p role="alert">{error}</p>}
    {status && <><p>{status.configured ? "Server credential configured" : "Server OPENROUTER_API_KEY not configured. Never paste keys into this page or chat."}</p><p>Model: {status.model}</p><p>Exact synthetic prompt:</p><pre>{status.prompt}</pre><p>{status.limit} Maximum 64 output tokens. Cost may apply; missing cost means unknown, not free.</p><label><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} /> Send this synthetic prompt to OpenRouter; I approve this bounded test.</label><button disabled={!consent || !status.configured || busy} onClick={run}>{busy ? "Testing…" : "Run synthetic router test"}</button>
    <h3>Pilot receipts</h3><p>Separate from JEV decision-token totals. Reported model is not independent proof of routing internals.</p>{status.records.map((r: any) => <div key={r.id}><strong>{r.id}: {r.status}</strong>{r.status === "complete" && <p>Answer check: {r.correct ? "passed" : "failed"} · Model: {r.reportedModel ?? "unknown"} · {r.durationMs} ms · Input: {r.inputTokens ?? "unknown"} · Output: {r.outputTokens ?? "unknown"} · Reported USD: {r.reportedCostUsd ?? "unknown"}</p>}</div>)}</>}
  </section>;
}
