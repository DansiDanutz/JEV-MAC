import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, chmodSync, lstatSync } from "node:fs";
import path from "node:path";

export type Receipt = {
  id: string; source: "router" | "jev-mac" | "project-import";
  project: string; occurredAt: string; inputTokens: number; outputTokens: number;
  harness?: "codex" | "claude" | "hermes" | "kimi" | "glm" | "jev-mac" | "unknown";
  model?: string;
  durationMs?: number;
  outcome?: "decision-recorded" | "success" | "failure" | "unknown";
};
const metadata = ["harness", "model", "durationMs", "outcome"] as const;
const fields = ["id", "source", "project", "occurredAt", "inputTokens", "outputTokens", ...metadata];
export function receipt(value: unknown): Receipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("Receipt must be an object");
  const r = value as Record<string, unknown>;
  if (Object.keys(r).some(k => !fields.includes(k))) throw Error("Unsupported receipt field; prompts, paths and credentials must not be imported");
  if (typeof r.id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(r.id)) throw Error("Invalid receipt ID");
  if (!["router", "jev-mac", "project-import"].includes(String(r.source))) throw Error("Invalid receipt source");
  if (typeof r.project !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(r.project)) throw Error("Project must be a non-sensitive slug, not a path");
  if (typeof r.occurredAt !== "string" || !Number.isFinite(Date.parse(r.occurredAt))) throw Error("Receipt timestamp required");
  for (const key of ["inputTokens", "outputTokens"]) if (!Number.isSafeInteger(r[key]) || (r[key] as number) < 0 || (r[key] as number) > 1e9) throw Error("Invalid token count");
  if (r.harness !== undefined && !["codex", "claude", "hermes", "kimi", "glm", "jev-mac", "unknown"].includes(String(r.harness))) throw Error("Invalid harness");
  if (r.model !== undefined && (typeof r.model !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,99}$/.test(r.model) || /sk-|token|secret|key/i.test(r.model))) throw Error("Invalid model identifier");
  if (r.durationMs !== undefined && (!Number.isSafeInteger(r.durationMs) || (r.durationMs as number) < 0 || (r.durationMs as number) > 86400000)) throw Error("Invalid duration");
  if (r.outcome !== undefined && !["decision-recorded", "success", "failure", "unknown"].includes(String(r.outcome))) throw Error("Invalid outcome");
  const result: Receipt = { id: r.id, source: r.source as Receipt["source"], project: r.project, occurredAt: new Date(r.occurredAt).toISOString(), inputTokens: r.inputTokens as number, outputTokens: r.outputTokens as number };
  for (const key of metadata) if (r[key] !== undefined) Object.assign(result, { [key]: r[key] });
  return result;
}
export function receiptId(source: string, event: string) { return createHash("sha256").update(source + ":" + event).digest("hex"); }

export class ReceiptStore {
  private db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (lstatSync(directory).isSymbolicLink()) throw Error("Receipt directory cannot be a symlink");
    chmodSync(directory, 0o700);
    const file = path.join(directory, "usage-receipts.sqlite");
    try { if (lstatSync(file).isSymbolicLink()) throw Error("Receipt database cannot be a symlink"); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.db.exec("PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, value TEXT NOT NULL)");
  }
  add(value: unknown): boolean {
    const r = receipt(value), encoded = JSON.stringify(r);
    const result = this.db.prepare("INSERT OR IGNORE INTO receipts VALUES (?,?)").run(r.id, encoded);
    if (!result.changes) {
      const previous = this.db.prepare("SELECT value FROM receipts WHERE id=?").get(r.id);
      const old = receipt(JSON.parse(String(previous?.value)));
      // Enrich legacy receipts, never replace known attribution or token counts.
      for (const key of fields as (keyof Receipt)[]) {
        if (old[key] !== undefined && r[key] !== undefined && old[key] !== r[key]) throw Error("Receipt ID conflict; existing record was not overwritten");
      }
      const merged = receipt({ ...old, ...r });
      this.db.prepare("UPDATE receipts SET value=? WHERE id=?").run(JSON.stringify(merged), r.id);
    }
    return Boolean(result.changes);
  }
  list(): Receipt[] { return this.db.prepare("SELECT value FROM receipts ORDER BY id").all().map(r => receipt(JSON.parse(String(r.value)))); }
  close() { this.db.close(); }
}
