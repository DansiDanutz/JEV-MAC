import React, {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import { Analytics } from "./Analytics.tsx";
import { RouterHealth } from "./RouterHealth.tsx";
import { Connect, ConnectionCode } from "./Connect.tsx";

type Root = { id: string; path: string; scanStatus?: string };
type Job = {
  id: string;
  type: string;
  status: string;
  progress: number;
  error?: string;
  createdAt: string;
};
type FileItem = {
  id: string;
  rootId: string;
  path: string;
  relativePath: string;
  size: number;
  hash?: string;
  category?: string;
  protectedReason?: string;
  classification?: string;
};
type Duplicate = {
  hash: string;
  files: FileItem[];
  logicalBytes: number;
  ignored?: boolean;
  totalFiles?: number;
};
type Finding = {
  id: string;
  severity: string;
  title: string;
  detail: string;
  path?: string;
};
type PlanItem = {
  fileId: string;
  source: string;
  destination: string;
  reason: string;
};
type Plan = {
  id: string;
  kind: "quarantine" | "organize";
  status: string;
  items: PlanItem[];
  createdAt: string;
  keeper?: { path: string };
};
type Operation = {
  id: string;
  planId: string;
  source: string;
  destination: string;
  status: string;
  kind: string;
  error?: string;
};
type AppState = {
  roots: Root[];
  jobs: Job[];
  files: FileItem[];
  duplicates: Duplicate[];
  findings: Finding[];
  plans: Plan[];
  operations: Operation[];
  settings: { jevConfigured: boolean };
  summary: {
    files: number;
    bytes: number;
    duplicateGroups: number;
    incompleteRoots?: string[];
  };
  fileTotal: number;
};
type Page =
  | "JEV Analytics"
  | "Router Health"
  | "Overview"
  | "Files"
  | "Review / Plans"
  | "Doctor"
  | "History"
  | "Settings";

const emptyState: AppState = {
  roots: [],
  jobs: [],
  files: [],
  duplicates: [],
  findings: [],
  plans: [],
  operations: [],
  settings: { jevConfigured: false },
  summary: { files: 0, bytes: 0, duplicateGroups: 0 },
  fileTotal: 0,
};
const pages: { name: Page; icon: string }[] = [
  { name: "JEV Analytics", icon: "▥" },
  { name: "Router Health", icon: "⇄" },
  { name: "Overview", icon: "⌂" },
  { name: "Files", icon: "▤" },
  { name: "Review / Plans", icon: "◇" },
  { name: "Doctor", icon: "✚" },
  { name: "History", icon: "↺" },
  { name: "Settings", icon: "⚙" },
];

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    Math.floor(Math.log(value) / Math.log(1024)),
    units.length - 1,
  );
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}
function date(value?: string) {
  return value ? new Date(value).toLocaleString() : "—";
}
function statusClass(value: string) {
  return `status status-${value.toLowerCase().replace(/[^a-z]+/g, "-")}`;
}

function App() {
  const [token, setToken] = useState(
    () => new URLSearchParams(location.hash.replace(/^#/, "")).get("token") || sessionStorage.getItem("jev-token") || "",
  );
  const [tokenDraft, setTokenDraft] = useState("");
  const [state, setState] = useState<AppState>(emptyState);
  const [page, setPage] = useState<Page>("Overview");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showIgnored, setShowIgnored] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [folderDialog, setFolderDialog] = useState(false);
  const [notice, setNotice] = useState("");
  const [planDialog, setPlanDialog] = useState<Plan | null>(null);
  const [classifyDialog, setClassifyDialog] = useState<{
    previewId: string;
    payload: unknown;
  } | null>(null);
  const [consent, setConsent] = useState(false);
  const inFlight = useRef(false);
  const limit = 100;
  function chooseFolder(location: string) {
    setNotice(
      "The Mac folder picker is opening. Choose a folder, or press Cancel.",
    );
    void action(
      "picker",
      "/api/folder-picker",
      { location },
      (result: { path: string | null; cancelled: boolean }) => {
        setNotice(
          result.cancelled
            ? "Folder selection cancelled. Nothing was connected or scanned."
            : "",
        );
        if (result.path) {
          setRootPath(result.path);
          setFolderDialog(true);
        }
      },
    );
  }
  function folderChoices() {
    return (
      <Card title="1. Choose what to organize">
        <p className="muted">
          Pick a folder on this Mac. You’ll confirm it before connecting.
          Nothing is uploaded or changed.
        </p>
        <div className="folder-choices">
          {(
            [
              ["downloads", "Downloads", "Review downloaded files"],
              ["desktop", "Desktop", "Review screenshots and loose files"],
              ["documents", "Documents", "Choose a project or document folder"],
              [
                "other",
                "Choose another folder",
                "Browse this Mac or an external drive",
              ],
            ] as const
          ).map(([id, label, description]) => (
            <button
              key={id}
              disabled={!!busy || !!activeJob}
              onClick={() => chooseFolder(id)}
            >
              <strong>{label}</strong>
              <small>{description}</small>
            </button>
          ))}
        </div>
        <p className="muted">
          2. Connect folder → 3. Scan files → 4. Review suggestions. Changes
          always need your approval.
        </p>
        {notice && <p role="status">{notice}</p>}
        {busy === "picker" && (
          <p role="status">
            Waiting for the Mac folder picker… It may be behind your browser
            window.
          </p>
        )}
      </Card>
    );
  }

  useEffect(() => {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    const supplied = params.get("token");
    if (supplied) {
      sessionStorage.setItem("jev-token", supplied);
      setToken(supplied);
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector(".workspace")?.scrollTo(0, 0);
  }, [page]);

  const request = useCallback(
    async <T,>(
      path: string,
      init?: RequestInit,
      signal?: AbortSignal,
    ): Promise<T> => {
      const headers = new Headers(init?.headers);
      if (token) headers.set("Authorization", `Bearer ${token}`);
      if (init?.body) headers.set("Content-Type", "application/json");
      const response = await fetch(path, { ...init, headers, signal });
      const body = await response.json().catch(() => ({}));
      if (response.status === 401) {
        sessionStorage.removeItem("jev-token");
        setToken("");
        setState(emptyState);
      }
      if (!response.ok)
        throw new Error(
          body.error || body.message || `Request failed (${response.status})`,
        );
      return body as T;
    },
    [token],
  );

  const loadState = useCallback(
    async (signal?: AbortSignal) => {
      if (!token || inFlight.current) return;
      inFlight.current = true;
      try {
        const query = new URLSearchParams({
          search,
          offset: String(offset),
          limit: String(limit),
        });
        setState(
          await request<AppState>(`/api/state?${query}`, undefined, signal),
        );
      } catch (reason) {
        if ((reason as Error).name !== "AbortError")
          setError((reason as Error).message);
      } finally {
        inFlight.current = false;
        setLoading(false);
      }
    },
    [offset, request, search, token],
  );

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setLoading(true);
    loadState(controller.signal);
    const timer = window.setInterval(() => loadState(controller.signal), 1000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      inFlight.current = false;
    };
  }, [loadState, token]);

  async function action(
    name: string,
    path: string,
    body: unknown,
    done?: (result: any) => void,
  ) {
    if (busy) return;
    setBusy(name);
    setError("");
    try {
      const result = await request<any>(path, {
        method: "POST",
        body: JSON.stringify(body),
      });
      done?.(result);
      await loadState();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy("");
    }
  }

  const activeJob = state.jobs.find((job) =>
    ["queued", "running", "cancelling", "stopping"].includes(
      job.status.toLowerCase(),
    ),
  );
  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const saveToken = (event: FormEvent) => {
    event.preventDefault();
    const value = tokenDraft.trim();
    if (!value) return;
    sessionStorage.setItem("jev-token", value);
    setToken(value);
    setTokenDraft("");
  };
  const logOut = () => {
    sessionStorage.removeItem("jev-token");
    setToken("");
    setState(emptyState);
  };

  if (!token)
    return (
      <main className="auth-shell">
        <div className="auth-card">
          <div className="brand-mark">J</div>
          <p className="eyebrow">Local Mac organizer</p>
          <h1>Connect to JEV-MAC</h1>
          <Connect onConnected={value => { sessionStorage.setItem("jev-token", value); setToken(value); setError(""); }} />
          <details><summary>Advanced: use a local session token</summary>
          <form onSubmit={saveToken}>
          <p className="muted">
            Enter the local session token supplied when the service starts. It
            stays in this browser session and is never displayed again.
          </p>
          <label>
            Session token
            <input
              type="password"
              autoComplete="off"
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              required
              autoFocus
            />
          </label>
          <button className="primary" type="submit">
            Open dashboard
          </button>
          </form></details>
        </div>
      </main>
    );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">J</span>
          <span>
            <strong>JEV-MAC</strong>
            <small>On this Mac</small>
          </span>
        </div>
        <nav aria-label="Main navigation">
          {pages.map((item) => (
            <button
              key={item.name}
              className={page === item.name ? "nav-active" : ""}
              onClick={() => setPage(item.name)}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.name}
            </button>
          ))}
        </nav>
        <div className="privacy-note">
          <span className="privacy-dot" />
          Local session
          <br />
          <small>No automatic scans</small>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">JEV-MAC</p>
            <h1>{page}</h1>
          </div>
          <div className="top-actions">
            {page !== "JEV Analytics" && page !== "Router Health" && <button
              disabled={!!busy || loading}
              onClick={() => {
                setError("");
                void loadState();
              }}
            >
              Refresh status
            </button>}
            {page === "Files" && (
              <label className="search">
                <span className="sr-only">Search files</span>
                <input
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setOffset(0);
                  }}
                  placeholder="Search local catalog"
                />
              </label>
            )}
            <span className="local-pill">
              <i /> Local only
            </span>
          </div>
        </header>
        <main className="content">
          {page !== "JEV Analytics" && page !== "Router Health" && state.plans.some((p) => ["pending", "ready"].includes(p.status)) && (
            <Card title="Your next step: review these files">
              <p>Nothing moves until you confirm. Open a preview below to see exactly what will happen.</p>
              {state.plans.filter((p) => ["pending", "ready"].includes(p.status)).map((plan) => (
                <div className="plan-row" key={plan.id}>
                  <span>
                    <strong>{plan.kind === "quarantine" ? "Move to recoverable quarantine" : "Create organized copies"}</strong>
                    <small>{plan.items.map((item) => item.source).join(", ")}</small>
                  </span>
                  <button className="primary" disabled={!!busy || !!activeJob} onClick={() => setPlanDialog(plan)}>Review {plan.items.length} {plan.items.length === 1 ? "file" : "files"}</button>
                </div>
              ))}
            </Card>
          )}
          {page !== "JEV Analytics" && page !== "Router Health" && state.operations.some((op) => op.kind === "quarantine" && op.status === "complete") && (
            <Card title="Files moved safely — nothing permanently deleted">
              <p>{state.operations.filter((op) => op.kind === "quarantine" && op.status === "complete").length} file(s) are in recoverable quarantine. This does not free disk space.</p>
              <ul>{state.operations.filter((op) => op.kind === "quarantine" && op.status === "complete").slice(0, 3).map((op) => <li key={op.id}>{op.source}</li>)}</ul>
              <button onClick={() => setPage("History")}>View moved files / restore</button>
            </Card>
          )}
          {error && (
            <div className="alert error" role="alert">
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          {loading && state.roots.length === 0 ? (
            <div className="loading">Loading local state…</div>
          ) : (
            renderPage()
          )}
        </main>
      </div>
      {folderDialog && (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="folder-title"
          >
            <h2 id="folder-title">Connect this folder?</h2>
            <code className="root-code">{rootPath}</code>
            <p>
              This only adds the folder to your dashboard. Click Scan afterwards
              to build a local catalog. No files will be moved, deleted or
              uploaded.
            </p>
            <div className="dialog-actions">
              <button disabled={!!busy} onClick={() => setFolderDialog(false)}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={!!busy}
                onClick={() =>
                  action("root", "/api/roots", { path: rootPath }, () => {
                    setFolderDialog(false);
                    setRootPath("");
                    setPage("Overview");
                    setNotice(
                      "Folder connected. Click Scan to read its files. Scan again whenever you want to sync the catalog.",
                    );
                  })
                }
              >
                Connect folder
              </button>
            </div>
          </section>
        </div>
      )}
      {planDialog && (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="approve-title"
          >
            <p className="eyebrow">Check these files</p>
            <h2 id="approve-title">{planDialog.kind === "quarantine" ? "Move these files to quarantine?" : "Create these organized copies?"}</h2>
            <p>
              Only the files listed below will be affected. We check them again before making changes.
            </p>
            {planDialog.kind === "quarantine" && (
              <div className="alert warning">
                Quarantine is recoverable and does not reclaim disk space until
                you independently purge it.
              </div>
            )}
            {planDialog.keeper && (
              <div className="keep-summary">
                <strong>This copy stays in place</strong>
                <code>{planDialog.keeper.path}</code>
                <small>It will be checked again before quarantine.</small>
              </div>
            )}
            <div className="plan-items">
              {planDialog.items.map((item) => (
                <div key={item.fileId}>
                  <strong>{item.source}</strong>
                  <span>→ {item.destination}</span>
                  <small>{item.reason}</small>
                </div>
              ))}
            </div>
            <div className="dialog-actions">
              <button onClick={() => setPlanDialog(null)}>Cancel</button>
              <button
                className="primary"
                disabled={!!busy}
                onClick={() =>
                  action(
                    "apply",
                    "/api/apply",
                    { planId: planDialog.id, confirmation: planDialog.id },
                    () => { setPlanDialog(null); setPage("History"); },
                  )
                }
              >
                {busy === "apply"
                  ? "Starting…"
                  : planDialog.kind === "quarantine" ? "Move to quarantine" : "Create copies"}
              </button>
            </div>
          </section>
        </div>
      )}
      {classifyDialog && (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="consent-title"
          >
            <p className="eyebrow">Jev payload preview</p>
            <h2 id="consent-title">Review what leaves this Mac</h2>
            <pre>{JSON.stringify(classifyDialog.payload, null, 2)}</pre>
            <label className="check consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              I consent to send exactly this payload to Jev.
            </label>
            <div className="dialog-actions">
              <button
                onClick={() => {
                  setClassifyDialog(null);
                  setConsent(false);
                }}
              >
                Cancel
              </button>
              <button
                className="primary"
                disabled={!consent || !!busy}
                onClick={() =>
                  action(
                    "classify",
                    "/api/classify",
                    { previewId: classifyDialog.previewId, consent: true },
                    () => {
                      setClassifyDialog(null);
                      setConsent(false);
                    },
                  )
                }
              >
                {busy === "classify" ? "Sending…" : "Send payload"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );

  function renderPage() {
    if (page === "JEV Analytics") return <Analytics request={request} />;
    if (page === "Router Health") return <RouterHealth request={request} />;
    if (page === "Overview")
      return (
        <>
          <section className="hero">
            <div>
              <p className="eyebrow">Storage, with evidence</p>
              <h2>Know what is here before changing anything.</h2>
              <p>
                Scan only folders you choose. Review evidence and immutable
                plans before any recoverable operation.
              </p>
            </div>
            {state.roots.length === 0 ? (
              <button
                className="primary"
                disabled={!!busy}
                onClick={() =>
                  action("demo", "/api/demo", {}, (root: Root) =>
                    setState((current) => ({ ...current, roots: [root] })),
                  )
                }
              >
                {busy === "demo" ? "Creating…" : "Create safe demo"}
              </button>
            ) : (
              <button onClick={() => setPage("Files")}>Browse catalog</button>
            )}
          </section>
          {folderChoices()}
          {Boolean(state.summary.incompleteRoots?.length) && (
            <div
              className="alert warning"
              role="status"
              style={{ marginTop: 18 }}
            >
              Last scan incomplete; showing previous successful catalog where
              available.
              <br />
              <small>{state.summary.incompleteRoots!.join(", ")}</small>
            </div>
          )}
          <section className="stat-grid" aria-label="Catalog summary">
            <Stat
              label="Cataloged files"
              value={state.summary.files.toLocaleString()}
              note={`${state.roots.length} approved root${state.roots.length === 1 ? "" : "s"}`}
            />
            <Stat
              label="Logical size"
              value={formatBytes(state.summary.bytes)}
              note="Not estimated savings"
            />
            <Stat
              label="Exact duplicate groups"
              value={state.summary.duplicateGroups.toLocaleString()}
              note="Review required"
            />
          </section>
          <section className="split">
            <Card
              title="Your connected folders"
              action={
                <button onClick={() => setPage("Settings")}>Manage</button>
              }
            >
              <p className="muted">
                Scan reads files locally. Scan again to sync new or changed
                files—never to upload or delete them.
              </p>
              {state.roots.length ? (
                state.roots.map((root) => (
                  <div className="root-row" key={root.id}>
                    <span>
                      <strong>{root.path.split("/").pop()}</strong>
                      <code>{root.path}</code>
                    </span>
                    <button
                      disabled={!!busy || !!activeJob}
                      onClick={() =>
                        action("scan", "/api/scan", { rootId: root.id })
                      }
                    >
                      {root.scanStatus ? "Sync catalog" : "Scan"}
                    </button>
                  </div>
                ))
              ) : (
                <Empty
                  title="No folder approved"
                  text="Choose a folder above, or try Create safe demo first. Nothing is scanned automatically."
                />
              )}
            </Card>
            <Card title="Current activity">
              {activeJob ? (
                <div className="job">
                  <div className="row">
                    <strong>{activeJob.type}</strong>
                    <span className={statusClass(activeJob.status)}>
                      {activeJob.status}
                    </span>
                  </div>
                  <progress
                    aria-label={`${activeJob.progress} files processed`}
                  />
                  <div className="row muted">
                    <span>
                      {activeJob.progress.toLocaleString()} files processed
                    </span>
                    <button
                      disabled={
                        !!busy || activeJob.status.toLowerCase() === "stopping"
                      }
                      onClick={() =>
                        action("cancel", "/api/cancel", { jobId: activeJob.id })
                      }
                    >
                      {activeJob.status.toLowerCase() === "stopping"
                        ? "Stop pending"
                        : "Stop safely"}
                    </button>
                  </div>
                </div>
              ) : (
                <Empty
                  title="No active job"
                  text="Scans run only when you start them."
                />
              )}
            </Card>
          </section>
        </>
      );
    if (page === "Files")
      return (
        <>
          <div className="section-toolbar">
            <div>
              <h2>Local catalog</h2>
              <p>{state.fileTotal.toLocaleString()} matching files</p>
            </div>
            <div className="actions">
              <button
                disabled={!selected.size || !!busy}
                onClick={() =>
                  action(
                    "preview",
                    "/api/classify-preview",
                    { fileIds: [...selected] },
                    (result) => setClassifyDialog(result),
                  )
                }
              >
                Preview Jev payload
              </button>
              <button
                className="primary"
                disabled={!selected.size || !!busy}
                onClick={() =>
                  action(
                    "plan",
                    "/api/plan",
                    { kind: "organize", fileIds: [...selected] },
                    (result) => setPlanDialog(result.plan || result),
                  )
                }
              >
                Plan copy organization
              </button>
            </div>
          </div>
          <div className="notice">
            Organization copies files into the selected root’s{" "}
            <code>_JEV_Organized</code> folder. Originals are not moved.
          </div>
          <section className="table-card">
            <table>
              <thead>
                <tr>
                  <th>
                    <span className="sr-only">Select</span>
                  </th>
                  <th>File</th>
                  <th>Category</th>
                  <th>Size</th>
                  <th>Protection</th>
                </tr>
              </thead>
              <tbody>
                {state.files.map((file) => (
                  <tr key={file.id}>
                    <td>
                      <input
                        aria-label={`Select ${file.relativePath}`}
                        type="checkbox"
                        checked={selected.has(file.id)}
                        onChange={() => toggle(file.id)}
                      />
                    </td>
                    <td>
                      <strong>{file.relativePath}</strong>
                      <code>{file.path}</code>
                    </td>
                    <td>
                      {file.category || file.classification || "Unclassified"}
                    </td>
                    <td>{formatBytes(file.size)}</td>
                    <td>
                      {file.protectedReason ? (
                        <span className="status status-protected">
                          {file.protectedReason}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!state.files.length && (
              <Empty
                title="No files on this page"
                text={
                  search
                    ? "Try a different search."
                    : "Scan an approved root to build the catalog."
                }
              />
            )}
          </section>
          <div className="pagination">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - limit))}
            >
              Previous
            </button>
            <span>
              {state.fileTotal
                ? `${offset + 1}–${Math.min(offset + state.files.length, state.fileTotal)} of ${state.fileTotal}`
                : "0 files"}
            </span>
            <button
              disabled={offset + state.files.length >= state.fileTotal}
              onClick={() => setOffset(offset + limit)}
            >
              Next
            </button>
          </div>
        </>
      );
    if (page === "Review / Plans")
      return (
        <>
          <div className="section-toolbar">
            <div>
              <h2>Evidence and plans</h2>
              <p>Exact matches and explicit, reviewable actions.</p>
            </div>
            {selected.size > 0 && (
              <button
                disabled={!!busy}
                onClick={() =>
                  action(
                    "quarantine-plan",
                    "/api/plan",
                    { kind: "quarantine", fileIds: [...selected] },
                    (result) => setPlanDialog(result.plan || result),
                  )
                }
              >
                Plan quarantine for {selected.size}
              </button>
            )}
          </div>
          <section className="split review-layout">
            <Card title="Duplicate groups">
              <p className="muted">
                Choose a copy to keep first, then select the others to preview
                quarantine. Identical content does not mean every location is
                unnecessary.
              </p>
              <label className="ignored-toggle">
                <input
                  type="checkbox"
                  checked={showIgnored}
                  onChange={(e) => setShowIgnored(e.target.checked)}
                />
                Show ignored groups (
                {state.duplicates.filter((g) => g.ignored).length})
              </label>
              {state.duplicates.length ? (
                state.duplicates
                  .filter((group) => showIgnored || !group.ignored)
                  .map((group) => (
                    <DuplicateReview
                      key={group.hash}
                      group={group}
                      disabled={!!busy || !!activeJob}
                      onIgnore={() =>
                        action("ignore", "/api/duplicate-ignore", {
                          hash: group.hash,
                          ignored: !group.ignored,
                        })
                      }
                      onPreview={(keepFileId, fileIds) =>
                        action(
                          "duplicate-plan",
                          "/api/duplicate-plan",
                          { keepFileId, fileIds },
                          (result) => setPlanDialog(result),
                        )
                      }
                    />
                  ))
              ) : (
                <Empty
                  title="No exact duplicates"
                  text="Duplicate groups appear after hashing completes."
                />
              )}
              {!!state.duplicates.length &&
                !showIgnored &&
                state.duplicates.every((group) => group.ignored) && (
                  <p role="status">
                    All displayed groups are ignored. Turn on “Show ignored
                    groups” to bring them back.
                  </p>
                )}
            </Card>
            <Card title="Plans">
              {state.plans.length ? (
                state.plans.map((plan) => (
                  <div className="plan-row" key={plan.id}>
                    <span>
                      <strong>{plan.kind}</strong>
                      <small>
                        {plan.items.length} items · {date(plan.createdAt)}
                      </small>
                    </span>
                    <span className={statusClass(plan.status)}>
                      {plan.status}
                    </span>
                    {["ready", "pending"].includes(
                      plan.status.toLowerCase(),
                    ) && (
                      <button onClick={() => setPlanDialog(plan)}>
                        Review
                      </button>
                    )}
                  </div>
                ))
              ) : (
                <Empty
                  title="No plans yet"
                  text="Select files, then create a copy-organization or quarantine plan."
                />
              )}
            </Card>
          </section>
          <div className="alert warning">
            Quarantine does not reclaim disk space until you independently purge
            it. JEV-MAC never empties Trash automatically.
          </div>
        </>
      );
    if (page === "Doctor")
      return (
        <>
          <div className="section-toolbar">
            <div>
              <h2>Read-only findings</h2>
              <p>Evidence and narrow explanations—never automatic repair.</p>
            </div>
          </div>
          <section className="finding-list">
            {state.findings.length ? (
              state.findings.map((finding) => (
                <article key={finding.id}>
                  <span
                    className={`severity severity-${finding.severity.toLowerCase()}`}
                  >
                    {finding.severity}
                  </span>
                  <div>
                    <h3>{finding.title}</h3>
                    <p>{finding.detail}</p>
                    {finding.path && <code>{finding.path}</code>}
                  </div>
                </article>
              ))
            ) : (
              <Empty
                title="No findings"
                text="Doctor findings appear after a scan completes."
              />
            )}
          </section>
        </>
      );
    if (page === "History")
      return (
        <>
          <section className="split">
            <Card title="Jobs">
              {state.jobs.length ? (
                state.jobs.map((job) => (
                  <div className="history-row" key={job.id}>
                    <span>
                      <strong>{job.type}</strong>
                      <small>{date(job.createdAt)}</small>
                      {job.error && <em>{job.error}</em>}
                    </span>
                    <span className={statusClass(job.status)}>
                      {job.status}
                    </span>
                  </div>
                ))
              ) : (
                <Empty
                  title="No jobs"
                  text="Scan and classification jobs will be recorded here."
                />
              )}
            </Card>
            <Card title="Operations">
              {state.operations.length ? (
                state.operations.map((op) => (
                  <div className="operation" key={op.id}>
                    <div className="row">
                      <strong>{op.kind}</strong>
                      <span className={statusClass(op.status)}>
                        {op.status}
                      </span>
                    </div>
                    <code>{op.source}</code>
                    <span>→</span>
                    <code>{op.destination}</code>
                    {op.error && <em>{op.error}</em>}
                    {op.kind === "quarantine" &&
                      op.status.toLowerCase() === "complete" && (
                        <button
                          disabled={!!busy}
                          onClick={() =>
                            action("restore", "/api/restore", {
                              operationId: op.id,
                              confirmation: op.id,
                            })
                          }
                        >
                          Restore this operation
                        </button>
                      )}
                  </div>
                ))
              ) : (
                <Empty
                  title="No operations"
                  text="Applied plan operations and restores will appear here."
                />
              )}
            </Card>
          </section>
        </>
      );
    return (
      <section className="settings-grid">
        {folderChoices()}
        <Card title="Your connected folders">
          <details>
            <summary>Advanced: enter a folder path</summary>
            <form
              className="root-form"
              onSubmit={(e) => {
                e.preventDefault();
                action("root", "/api/roots", { path: rootPath }, () =>
                  setRootPath(""),
                );
              }}
            >
              <label>
                Folder path
                <input
                  placeholder="/Users/you/Documents/Test Folder"
                  value={rootPath}
                  onChange={(e) => setRootPath(e.target.value)}
                  required
                />
              </label>
              <button className="primary" disabled={!!busy}>
                Approve root
              </button>
            </form>
          </details>
          {state.roots.map((root) => (
            <code className="root-code" key={root.id}>
              {root.path}
            </code>
          ))}
        </Card>
        <Card title="Privacy and Jev">
          <ConnectionCode request={request} />
          <div className="setting-row">
            <span>
              <strong>Jev classification</strong>
              <small>
                Metadata leaves the Mac only after payload preview and consent.
              </small>
            </span>
            <span
              className={
                state.settings.jevConfigured
                  ? "status status-completed"
                  : "status status-neutral"
              }
            >
              {state.settings.jevConfigured ? "Configured" : "Not configured"}
            </span>
          </div>
          <div className="setting-row">
            <span>
              <strong>Session authentication</strong>
              <small>The token is held in session storage and not shown.</small>
            </span>
            <button onClick={logOut}>Forget token</button>
          </div>
        </Card>
      </section>
    );
  }
}

function DuplicateReview({
  group,
  disabled,
  onIgnore,
  onPreview,
}: {
  group: Duplicate;
  disabled: boolean;
  onIgnore: () => void;
  onPreview: (keeper: string, ids: string[]) => void;
}) {
  const [keepId, setKeepId] = useState("");
  const [copies, setCopies] = useState<Set<string>>(new Set());
  const keeper = group.files.find((f) => f.id === keepId);
  const eligible = group.files.filter(
    (f) =>
      keeper &&
      f.id !== keeper.id &&
      !f.protectedReason &&
      f.rootId === keeper.rootId,
  );
  const selectedIds = eligible.filter((f) => copies.has(f.id)).map((f) => f.id);
  return (
    <article
      className="duplicate-group"
      aria-label={`Duplicate group: ${group.files[0]?.relativePath}`}
    >
      <div className="duplicate-heading">
        <strong>
          {group.totalFiles || group.files.length} identical files
        </strong>
        <span>{formatBytes(group.logicalBytes)} logical duplicate size</span>
      </div>
      {(group.totalFiles || 0) > group.files.length && (
        <p>
          Showing the first {group.files.length} copies. Only visible,
          explicitly selected copies can be planned.
        </p>
      )}
      {group.ignored && <p className="status">Ignored — files untouched</p>}
      {group.files.map((file) => (
        <div
          className={`duplicate-copy ${keeper?.id === file.id ? "is-kept" : ""}`}
          key={file.id}
        >
          <div className="duplicate-copy-name">
            <strong>{file.path.split("/").pop()}</strong>
            <code>{file.path.slice(0, file.path.lastIndexOf("/"))}</code>
            <small>
              {formatBytes(file.size)} · {file.category || "file"}
            </small>
            {file.protectedReason && (
              <p className="protected-note">
                Protected: {file.protectedReason}
              </p>
            )}
          </div>
          <div className="duplicate-copy-actions">
            <button
              aria-pressed={keeper?.id === file.id}
              disabled={disabled || group.ignored}
              onClick={() => {
                setKeepId(file.id);
                setCopies(new Set());
              }}
            >
              {keeper?.id === file.id ? "Keeping this copy" : "Keep this copy"}
            </button>
            <label>
              <input
                type="checkbox"
                aria-label={`Quarantine ${file.relativePath}`}
                checked={selectedIds.includes(file.id)}
                disabled={
                  disabled ||
                  group.ignored ||
                  !eligible.some((f) => f.id === file.id)
                }
                onChange={() =>
                  setCopies((current) => {
                    const next = new Set(current);
                    next.has(file.id)
                      ? next.delete(file.id)
                      : next.add(file.id);
                    return next;
                  })
                }
              />
              Quarantine copy
            </label>
          </div>
        </div>
      ))}
      {!keeper && !group.ignored && (
        <p className="muted">
          Start by choosing “Keep this copy” on the file you want to retain.
        </p>
      )}
      {keeper && group.files.some((f) => f.rootId !== keeper.rootId) && (
        <p className="muted">
          Copies in another connected folder are not selected together. Review
          that folder separately.
        </p>
      )}
      <div className="duplicate-controls">
        <button
          disabled={disabled || group.ignored || !eligible.length}
          onClick={() => setCopies(new Set(eligible.map((f) => f.id)))}
        >
          Select other copies
        </button>
        <button
          className="primary"
          disabled={disabled || group.ignored || !selectedIds.length}
          onClick={() => keeper && onPreview(keeper.id, selectedIds)}
        >
          Preview quarantine
          {selectedIds.length ? ` (${selectedIds.length})` : ""}
        </button>
        <button disabled={disabled} onClick={onIgnore}>
          {group.ignored ? "Bring group back" : "Ignore group"}
        </button>
      </div>
      <small className="muted">
        Preview changes nothing. Quarantine requires a separate approval and
        remains reversible.
      </small>
    </article>
  );
}

function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="card">
      <header>
        <h2>{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}
function Stat({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <article className="stat">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <span aria-hidden="true">○</span>
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
