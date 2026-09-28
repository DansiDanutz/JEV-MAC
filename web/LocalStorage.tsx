import React, { useEffect, useState } from "react";
import type { localStorageReport } from "../src/local-storage.ts";
type Report = Awaited<ReturnType<typeof localStorageReport>>;
const bytes = (n: number) => `${(n / 1024 ** 3).toFixed(2)} GB`;
export function LocalStorage({ request, navigate, classify }: {
  request: (url: string, init?: RequestInit) => Promise<any>;
  navigate: (page: "Overview" | "Review / Plans" | "Doctor") => void;
  classify: (ids: string[]) => void;
}) {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  async function refresh() {
    setLoading(true); setError("");
    try { setReport(await request("/api/local-storage")); setSelected([]); }
    catch { setError("Storage report unavailable. Reconnect or retry; no files were changed."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, [request]);
  return <section aria-label="Local Storage review">
    <div className="section-toolbar"><div><h2>Make room for your next project</h2><p>Inspect → review → approve. Nothing is deleted by opening this tab.</p></div><button disabled={loading} onClick={refresh}>{loading ? "Checking…" : "Refresh storage"}</button></div>
    {error && <p role="alert">{error}</p>}
    {report && <>
      <div className="card"><h3>Disk headroom</h3>{report.disk ? <><p><strong>{bytes(report.disk.available)} available</strong> of {bytes(report.disk.total)}</p><p>{report.disk.belowReserve ? "Below the planning reserve. Review large candidates before starting new downloads or builds." : "Above the planning reserve."} Suggested reserve: {bytes(report.disk.reserve)} (10% or 20 GB, whichever is larger; a planning heuristic).</p></> : <p>Disk capacity unavailable—not zero.</p>}<p>Checked {new Date(report.checkedAt).toLocaleString()}</p></div>
      <div className="card"><h3>1. Choose coverage</h3><p>{report.scope}</p><p>{report.roots.length} connected folders · {report.cataloged} cataloged files</p><button onClick={() => navigate("Overview")}>Connect folders / scan</button></div>
      <div className="card"><h3>2. Review largest cataloged files</h3><p>Select up to 20 files, then preview the exact metadata JEV would receive. JEV categorizes; it cannot approve deletion.</p><button disabled={!selected.length} onClick={() => classify(selected)}>Preview JEV review ({selected.length})</button>
        {!report.candidates.length && <p>No cataloged files yet. Connect a folder and start a scan first.</p>}
        <div className="storage-candidates">{report.candidates.map(f => <article key={f.id} className="storage-candidate"><label><input type="checkbox" aria-label={`Review ${f.path}`} checked={selected.includes(f.id)} disabled={f.protected || (!selected.includes(f.id) && selected.length >= 20)} onChange={() => setSelected(current => current.includes(f.id) ? current.filter(id => id !== f.id) : [...current, f.id])} /><strong>{f.path}</strong></label><p>{bytes(f.bytes)} logical · {f.kind}</p><p>{f.reason}</p></article>)}</div>
      </div>
      <div className="card"><h3>3. Choose a safe action</h3><div className="actions"><button onClick={() => navigate("Review / Plans")}>Review duplicates / quarantine</button><button onClick={() => navigate("Doctor")}>Check folder overlap</button></div><p>Quarantine is recoverable but does not free disk space. Permanent erasure is not enabled here.</p></div>
      <div className="card"><h3>Apps, backups and GitHub projects</h3><p>Not yet audited. Automatic removal is blocked. A GitHub URL or an old modification date is not recovery proof.</p><ul><li>Apps: verify reinstall source, license, user data and running services.</li><li>Backups: verify an independent restore before retiring any copy. Time Machine is protected.</li><li>Projects: verify all branches and tags remotely, local changes, ignored files, submodules, LFS and a clean-room restore.</li><li>Archives: create on a chosen destination, verify extraction and hashes, then approve source removal separately.</li></ul></div>
      <details><summary>Coverage and space accounting limits</summary><ul>{report.limitations.map(text => <li key={text}>{text}</li>)}</ul></details>
    </>}
  </section>;
}
