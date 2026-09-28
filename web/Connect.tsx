import React, { useState } from "react";

export function Connect({ onConnected }: { onConnected: (token: string) => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <form onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || "Connection failed");
      onConnected(result.token);
    } catch (e) { setError(e instanceof Error ? e.message : "Connection failed. Retry."); }
    finally { setBusy(false); }
  }}>
    <h2>Connect this browser</h2>
    <ol><li>Open JEV-MAC in your unlocked browser (usually Chrome).</li><li>In Settings, click “Create connection code”.</li><li>Enter that one-time code below within two minutes.</li></ol>
    <p>If no browser is unlocked, double-click Start JEV-MAC.command first. Never enter your JEV API key here.</p>
    <label>Connection code<input autoComplete="off" value={code} maxLength={16} onChange={e => setCode(e.target.value)} required /></label>
    <button type="submit" className="primary" disabled={busy}>{busy ? "Connecting…" : "Connect this browser"}</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}

export function ConnectionCode({ request }: { request: <T>(path: string, init?: RequestInit) => Promise<T> }) {
  const [grant, setGrant] = useState<{ code: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <section><h2>Connect another browser</h2><p>This grants dashboard access to another browser on this Mac. Create a code only for a browser you control. File changes still require approval. Codes expire after two minutes and work once; a new code replaces the previous one.</p>
    <button disabled={busy} onClick={async () => {
      setBusy(true); setError(""); setGrant(null);
      try { setGrant(await request("/api/connect-code", { method: "POST", body: "{}" })); }
      catch { setError("Could not create a code. Check your connection and retry."); }
      finally { setBusy(false); }
    }}>{busy ? "Creating…" : "Create connection code"}</button>
    {grant && <p role="status">Connection code: <code>{grant.code}</code><br/>Expires at {new Date(grant.expiresAt).toLocaleTimeString()}. Enter it on the other browser’s connection screen. Do not share it in chat.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
