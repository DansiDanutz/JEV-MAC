import React, { useEffect, useState } from "react";
import type { routerHealth } from "../src/router-health.ts";
type Health = Awaited<ReturnType<typeof routerHealth>>;
export function RouterHealth({ request }: { request: <T>(path: string) => Promise<T> }) {
  const [report, setReport] = useState<Health | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function refresh() {
    setBusy(true); setError("");
    try { setReport(await request<Health>("/api/router-health")); }
    catch { setError("Could not check the router. Check your dashboard connection and retry."); }
    finally { setBusy(false); }
  }
  useEffect(() => { void refresh(); }, [request]);
  return <section className="jev-analytics">
    <div className="section-toolbar"><div><h2>JEV Router checks</h2><p>Local evidence, not a guarantee of reliability.</p></div><button disabled={busy} onClick={refresh}>{busy ? "Checking…" : "Refresh router checks"}</button></div>
    {error && <p role="alert">{error}</p>}
    {!report ? <p role="status">{busy ? "Reading local installation and permissions…" : "No report loaded."}</p> : <>
      <p>Checked {new Date(report.checkedAt).toLocaleString()}. No paid calls, prompts read, or configuration changes from this check.</p>
      <section className="card"><h2>Installation</h2><p>{report.version ? `jev-router ${report.version} found in the known npm installation.` : "Router version unavailable at the known npm location."}</p><a href="https://github.com/gargpratyush/jev-router" target="_blank" rel="noreferrer">View open-source repository</a><p>Installing it does not route Codex desktop chats.</p></section>
      <section className="card"><h2>Routing evidence</h2><p>{report.recordedDecisions} saved metered router decisions. This does not prove the router is running now, or that every task succeeds.</p>
        {!report.recent.length && <p>No metered routing evidence yet. A separately approved live test is needed.</p>}
        {report.recent.map((r,i) => <article className="operation" key={i}><strong>{r.harness} → {r.model}</strong><p>{new Date(r.at).toLocaleString()} · {r.tokens.toLocaleString()} JEV decision tokens</p></article>)}
        <p>Task correctness, Claude compatibility, tool-loop behavior and savings require separate tests. A receipt alone cannot verify them.</p></section>
      <section className="card"><h2>Log privacy</h2><p><strong>{report.privacy.restricted ? "Checked log permissions are restricted" : "Log permissions need attention or could not be fully checked"}</strong></p><p>Directory mode: {report.privacy.directoryMode ?? "unavailable"}. {report.privacy.checkedFiles} files checked; {report.privacy.insecureFiles} allow group/other access; {report.privacy.skippedFiles} skipped.</p><p>{report.privacy.complete ? "Bounded inspection complete." : "Inspection incomplete."} POSIX modes only, not ACLs or all system security. Future files may use different permissions.</p><p>The router’s own logs can contain prompts and responses. JEV-MAC receipts do not copy those bodies.</p></section>
      <section className="card"><h2>Start a routed session</h2><p>In Terminal, inside your project:</p><p>Codex: <code>jev-codex</code> · Resume: <code>jev-codex resume --last</code></p><p>Claude Code: <code>jev-claude</code></p><p>Explain inside a routed session: <code>$jev-explain</code> in Codex or <code>/jev-explain</code> in Claude.</p><p>Guidance only. This page does not launch agents or spend tokens.</p></section>
      <section className="card"><h2>Reliability watchlist</h2><p>Keep routing optional until your workflows are tested. Reported concerns from the September 28, 2026 audit—not live issue-status checks:</p><ul>
        <li><a href="https://github.com/gargpratyush/jev-router/issues/48" target="_blank" rel="noreferrer">Claude hook output can skip routing (#48)</a></li>
        <li><a href="https://github.com/gargpratyush/jev-router/issues/49" target="_blank" rel="noreferrer">Codex same-tier choices can prevent downgrading (#49)</a></li>
        <li><a href="https://github.com/gargpratyush/jev-router/issues/45" target="_blank" rel="noreferrer">Codex tool loops can cause repeated decisions (#45)</a></li>
      </ul><p>Refresh does not fix upstream bugs or run a paid benchmark.</p></section>
    </>}
  </section>;
}
