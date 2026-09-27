import React, {
  FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

type Root = { id: string; path: string };
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
type Duplicate = { hash: string; files: FileItem[]; logicalBytes: number };
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
    () => sessionStorage.getItem("jev-token") || "",
  );
  const [tokenDraft, setTokenDraft] = useState("");
  const [state, setState] = useState<AppState>(emptyState);
  const [page, setPage] = useState<Page>("Overview");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [planDialog, setPlanDialog] = useState<Plan | null>(null);
  const [classifyDialog, setClassifyDialog] = useState<{
    previewId: string;
    payload: unknown;
  } | null>(null);
  const [consent, setConsent] = useState(false);
  const inFlight = useRef(false);
  const limit = 100;

  useEffect(() => {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    const supplied = params.get("token");
    if (supplied) {
      sessionStorage.setItem("jev-token", supplied);
      setToken(supplied);
      history.replaceState(null, "", `${location.pathname}${location.search}`);
    }
  }, []);

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
        setError("");
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
        <form className="auth-card" onSubmit={saveToken}>
          <div className="brand-mark">J</div>
          <p className="eyebrow">Local Mac organizer</p>
          <h1>Connect to JEV-MAC</h1>
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
        </form>
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
      {planDialog && (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="approve-title"
          >
            <p className="eyebrow">Immutable plan</p>
            <h2 id="approve-title">Approve exact {planDialog.kind} plan?</h2>
            <p>
              This approves plan <code>{planDialog.id}</code> only. Sources are
              revalidated before any operation.
            </p>
            {planDialog.kind === "quarantine" && (
              <div className="alert warning">
                Quarantine is recoverable and does not reclaim disk space until
                you independently purge it.
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
                    () => setPlanDialog(null),
                  )
                }
              >
                {busy === "apply"
                  ? "Applying…"
                  : `Approve plan ${planDialog.id}`}
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
              title="Approved roots"
              action={
                <button onClick={() => setPage("Settings")}>Manage</button>
              }
            >
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
                      Scan
                    </button>
                  </div>
                ))
              ) : (
                <Empty
                  title="No folder approved"
                  text="Start with a generated fixture. Nothing on your Mac will be scanned."
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
          <section className="split">
            <Card title="Duplicate groups">
              {state.duplicates.length ? (
                state.duplicates.map((group) => (
                  <details key={group.hash}>
                    <summary>
                      <span>{group.files.length} exact files</span>
                      <strong>{formatBytes(group.logicalBytes)} logical</strong>
                    </summary>
                    {group.files.map((file) => (
                      <label className="duplicate-file" key={file.id}>
                        <input
                          type="checkbox"
                          checked={selected.has(file.id)}
                          onChange={() => toggle(file.id)}
                        />
                        <code>{file.path}</code>
                      </label>
                    ))}
                  </details>
                ))
              ) : (
                <Empty
                  title="No exact duplicates"
                  text="Duplicate groups appear after hashing completes."
                />
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
        <Card title="Approved roots">
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
          {state.roots.map((root) => (
            <code className="root-code" key={root.id}>
              {root.path}
            </code>
          ))}
        </Card>
        <Card title="Privacy and Jev">
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
