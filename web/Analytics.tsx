import React, { useEffect, useState } from "react";
import type { collectAnalytics } from "../src/analytics.ts";
type Report = Awaited<ReturnType<typeof collectAnalytics>>;
export function Analytics({ request }: { request: <T>(path: string) => Promise<T> }) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function refresh() {
    setBusy(true); setError("");
    try { setReport(await request<Report>("/api/jev-analytics")); }
    catch { setError("Could not read local analytics. Check the dashboard connection and retry."); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, [request]);
  const count = (n: number) => n.toLocaleString();
  return <section className="jev-analytics">
    <div className="section-toolbar"><div><h2>JEV on this Mac</h2><p>Usage evidence, available tools, and what they optimize.</p></div><button disabled={busy} onClick={refresh}>{busy ? "Reading local records…" : "Refresh JEV analytics"}</button></div>
    {error && <p role="alert">{error}</p>}
    {!report ? <p role="status">{busy ? "Checking known JEV logs. No paid calls or uploads." : "No report loaded."}</p> : <>
      <p>Checked {new Date(report.collectedAt).toLocaleString()}. Read-only; no background auditing.</p>
      <section className="card"><h2>Recorded usage — not lifetime totals</h2>
        <h3>{report.meteredRecords ? count(report.totalInput + report.totalOutput) + " JEV tokens" : "Token usage unavailable"}</h3>
        <p>{count(report.totalInput)} input · {count(report.totalOutput)} output from {count(report.meteredRecords)} retained metered records.</p>
        <p><strong>{report.unmeteredRecords} records have no token counts.</strong> Unknown consumption is not zero consumption.</p>
        <h3>Without JEV / tokens saved: not measured</h3><p>No matched baseline. Routing changes model choice, not necessarily token quantity.</p>
      </section>
      <div className="alert warning">{report.coverage}</div>
      <section className="card"><h2>Installed integration locations</h2><p>Presence checks only. A checkout or plugin folder does not prove it is enabled or serving production projects.</p>{report.installations.map(i => <p key={i.location}><strong>{i.name}: {i.present ? "found" : "not found"}</strong><br/><code>~/{i.location}</code></p>)}</section>
      <section className="card"><h2>Where the numbers come from</h2>{report.sources.map((s, i) => <article className="operation" key={i}>
        <h3>{s.name}</h3><code>{s.location}</code><p>{s.records} retained records · {s.metered} with token receipts · {count(s.input + s.output)} recorded tokens</p>
        <p>Observed dates: {s.earliest ?? "unavailable"} — {s.latest ?? "unavailable"}. Not installation dates.</p>
        {Object.entries(s.models).map(([model, n]) => <p key={model}>{model}: {n} decision record(s), not confirmed task completions</p>)}
        <ul>{s.warnings.map(w => <li key={w}>{w}</li>)}</ul>
      </article>)}</section>
      <section className="card"><h2>How optimization works</h2><ul>
        <li><strong>Routing:</strong> a small decision call selects a suitable model. Savings require lower downstream cost to exceed JEV overhead. Subscription allowance is not a per-token cash bill.</li>
        <li><strong>Context filtering:</strong> less text can mean fewer writer tokens, but lost facts and retries can erase the benefit. Compare quality too.</li>
        <li><strong>Local work first:</strong> scans, duplicate hashes and approved file moves use no JEV tokens. Classification caches identical payloads and caps requests at 20 per day.</li>
        <li><strong>Separate tools:</strong> RTK compression and deterministic checks are not JEV savings. Installing a skill does not activate it across all harnesses.</li>
      </ul></section>
      <section className="card"><h2>Features for your Mac and projects</h2><p>Installed means a skill file exists—not that its service, login, driver or permissions passed a live test. These are instructions, not execution buttons. Paid work and data sharing still require approval.</p>
        <p><strong>Claude Code:</strong> <code>jev-claude</code>. <strong>Codex:</strong> <code>jev-codex</code>. <strong>Kimi / GLM:</strong> shared CLI skills through the host agent; automatic integration is unverified.</p>
        {report.features.map(f => <details className="operation" key={f.skill}><summary><strong>{f.title}</strong> — {f.installed ? "Skill installed" : "Skill not found"}</summary><p>{f.use}</p><code>{f.command}</code><p>{f.caveat}</p><small>Skill: {f.skill}</small></details>)}
      </section>
      <section className="card"><h2>What a fair savings report still needs</h2><p>Provider exports and matched tasks with the same quality criteria, context, retries, cache usage and prices—with and without JEV. Keep routing tokens separate from downstream agent tokens.</p><p>No broad project scan, provider login, paid benchmark or configuration change was performed. Per-project attribution needs project-tagged receipts. Historical savings cannot be reconstructed from missing receipts.</p></section>
      <section className="card"><h2>More installed CLI capabilities</h2><p>Run <code>jev --help</code> for details. Commands are not run by this page.</p><ul>
        <li><code>jev spend</code>: analyze supplied metered usage exports.</li>
        <li><code>jev replay</code>: compare routing policies on logged tasks; review costs and privacy before a live replay.</li>
        <li><code>jev triage</code>: prioritize incoming support messages.</li>
        <li><code>jev plan</code> / <code>jev memo</code>: bounded action planning and plan-cache inspection.</li>
        <li><code>jev models</code> / <code>jev dashboard</code>: model catalog and Hermes routing management. Changes there can affect live agents.</li>
        <li><code>jev ask</code>: structured decision API; <code>jev setup-key</code> / <code>jev doctor</code>: private setup and connectivity checks. A health check can contact the provider.</li>
      </ul></section>
    </>}
  </section>;
}
