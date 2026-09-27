import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { analyzeCatalog, referenceEvidence } from "./doctor.ts";

const run = promisify(execFile);
const native = fileURLToPath(new URL("../native/fsops", import.meta.url));
const protectedNames = new Set([
  ".git",
  ".svn",
  ".hg",
  ".ssh",
  ".aws",
  ".gnupg",
  ".codex",
  ".claude",
  ".kimi",
  ".agents",
  ".Trash",
  "Library",
  "System",
  "Applications",
  "Backups.backupdb",
  ".timemachine",
  ".MobileBackups",
  ".Spotlight-V100",
  ".fseventsd",
  ".DocumentRevisions-V100",
  ".jev-mac-quarantine",
  "_JEV_Organized",
]);
const secret = /(^\.env($|\.)|\.(pem|key|p12|pfx)$|credentials|secrets?\.)/i;
const bundle =
  /\.(app|photoslibrary|photolibrary|backupbundle|sparsebundle|framework|icloud)$/i;
const repositoryMarkers = [".git", ".hg", ".svn"];
async function isRepository(directory: string) {
  return (
    await Promise.all(
      repositoryMarkers.map((marker) =>
        fs.lstat(path.join(directory, marker)).then(
          () => true,
          () => false,
        ),
      ),
    )
  ).some(Boolean);
}
export type Identity = {
  dev: string;
  ino: string;
  size: number;
  mtime: string;
  hash: string;
  links: number;
  allocated: number;
};
export type FileRecord = Identity & {
  id: string;
  rootId: string;
  path: string;
  relativePath: string;
  category: string;
  modifiedAt: string;
  protectedReason?: string;
  classification?: unknown;
};
export type Root = {
  id: string;
  path: string;
  dev: string;
  ino: string;
  scanStatus?: string;
};
export type Job = {
  id: string;
  type: string;
  status: string;
  progress: number;
  createdAt: string;
  error?: string;
};
type Item = {
  fileId: string;
  source: string;
  destination: string;
  reason: string;
  identity: Identity;
};
export type Plan = {
  id: string;
  rootId: string;
  kind: "quarantine" | "organize";
  status: string;
  items: Item[];
  createdAt: string;
};
export type Operation = {
  id: string;
  planId: string;
  rootId: string;
  kind: string;
  source: string;
  destination: string;
  status: string;
  identity: Identity;
  error?: string;
  phase?: "restore";
};
const now = () => new Date().toISOString();
export function within(root: string, target: string) {
  const rel = path.relative(root, target);
  return (
    rel === "" ||
    (!rel.startsWith(`..${path.sep}`) && rel !== ".." && !path.isAbsolute(rel))
  );
}
function requireString(value: unknown, label: string) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 4096 ||
    value.includes("\0")
  )
    throw Error(`Invalid ${label}`);
  return value;
}
export function localCategory(name: string) {
  if (/screenshot|screen shot|captur[ae]/i.test(name)) return "screenshot";
  const ext = path.extname(name).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".heic", ".webp", ".gif", ".svg"].includes(ext))
    return "image";
  if ([".mp4", ".mov", ".mkv", ".webm"].includes(ext)) return "video";
  if ([".zip", ".tar", ".gz", ".7z"].includes(ext)) return "archive";
  if ([".ts", ".js", ".py", ".rs", ".go", ".swift", ".c"].includes(ext))
    return "source-code";
  if ([".pdf", ".txt", ".md", ".docx", ".csv", ".xlsx"].includes(ext))
    return "document";
  return "other";
}

export class Engine {
  db: DatabaseSync;
  active = new Map<string, AbortController>();
  mutation = false;
  dataDir: string;
  degraded = false;
  private grants = new Map<
    string,
    { action: string; id: string; expires: number; digest: string }
  >();
  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.db = new DatabaseSync(path.join(dataDir, "catalog.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL,id TEXT NOT NULL,value TEXT NOT NULL, PRIMARY KEY(kind,id));",
    );
    for (const job of this.list<Job>("job"))
      if (["running", "queued", "stopping"].includes(job.status))
        this.put("job", {
          ...job,
          status: "interrupted",
          error: "Service restarted. Start a fresh job.",
        });
    for (const plan of this.list<Plan>("plan"))
      if (plan.status === "applying")
        this.put("plan", { ...plan, status: "needs-recovery" });
  }
  put<T extends { id: string }>(kind: string, value: T) {
    try {
      this.db
        .prepare("INSERT OR REPLACE INTO records VALUES (?,?,?)")
        .run(kind, value.id, JSON.stringify(value));
    } catch (e) {
      this.degraded = true;
      throw e;
    }
  }
  get<T>(kind: string, id: string): T {
    const row = this.db
      .prepare("SELECT value FROM records WHERE kind=? AND id=?")
      .get(kind, id);
    if (!row) throw Error(`${kind} not found`);
    return JSON.parse(row.value as string);
  }
  list<T>(kind: string): T[] {
    return this.db
      .prepare("SELECT value FROM records WHERE kind=? ORDER BY rowid DESC")
      .all(kind)
      .map((r) => JSON.parse(r.value as string));
  }
  private write(sql: string, ...args: import("node:sqlite").SQLInputValue[]) {
    try {
      return this.db.prepare(sql).run(...args);
    } catch (e) {
      this.degraded = true;
      throw e;
    }
  }
  remove(kind: string, id: string) {
    this.write("DELETE FROM records WHERE kind=? AND id=?", kind, id);
  }
  async validateRoot(root: Root) {
    const real = await fs.realpath(root.path);
    const stat = await fs.lstat(root.path, { bigint: true });
    if (
      real !== root.path ||
      stat.isSymbolicLink() ||
      !stat.isDirectory() ||
      String(stat.dev) !== root.dev ||
      String(stat.ino) !== root.ino
    )
      throw Error("Root identity changed; register it again");
  }
  async addRoot(input: unknown) {
    const requested = path.resolve(requireString(input, "root path"));
    const real = await fs.realpath(requested);
    const stat = await fs.lstat(real, { bigint: true });
    if (!stat.isDirectory()) throw Error("Choose a folder");
    if (
      [
        path.parse(real).root,
        os.homedir(),
        "/Users",
        "/Volumes",
        "/private",
        "/private/var",
        "/private/tmp",
        "/tmp",
      ].includes(real)
    )
      throw Error(
        "Choose a specific non-system subfolder, not an entire home or volume collection",
      );
    const parts = real.split(path.sep);
    if (parts.some((p) => protectedNames.has(p) || bundle.test(p)))
      throw Error("Protected location");
    if (
      !within(os.homedir(), real) &&
      !within("/private/tmp", real) &&
      !within("/Volumes", real)
    )
      throw Error(
        "Choose a folder under your home, a test folder or an external volume",
      );
    const old = this.list<Root>("root").find((r) => r.path === real);
    if (old) {
      await this.validateRoot(old);
      return old;
    }
    const root = {
      id: randomUUID(),
      path: real,
      dev: String(stat.dev),
      ino: String(stat.ino),
    };
    this.put("root", root);
    return root;
  }
  async inspect(
    root: Root,
    relative: string,
    signal?: AbortSignal,
  ): Promise<Identity> {
    if (path.isAbsolute(relative) || relative.split(path.sep).includes(".."))
      throw Error("Path escapes root");
    const { stdout } = await run(
      native,
      ["inspect", root.path, relative, root.dev, root.ino],
      { signal, maxBuffer: 8192 },
    );
    return JSON.parse(stdout);
  }
  start(type: string, work: (signal: AbortSignal, job: Job) => Promise<void>) {
    if (this.degraded)
      throw Error(
        "Storage journal degraded. Resolve storage and restart before more work.",
      );
    if (this.active.size || this.mutation)
      throw Error("A job is active. Stop it or wait before starting another.");
    const job: Job = {
      id: randomUUID(),
      type,
      status: "running",
      progress: 0,
      createdAt: now(),
    };
    const controller = new AbortController();
    try {
      this.put("job", job);
    } catch (e) {
      this.degraded = true;
      throw e;
    }
    this.active.set(job.id, controller);
    setImmediate(async () => {
      try {
        await work(controller.signal, job);
        job.status = controller.signal.aborted ? "cancelled" : "complete";
      } catch (e) {
        job.status = controller.signal.aborted ? "cancelled" : "failed";
        job.error = e instanceof Error ? e.message : "Job failed";
      } finally {
        try {
          this.put("job", job);
        } catch {
          this.degraded = true;
          console.error(
            "Job journal could not be saved; inspect storage before retrying.",
          );
        } finally {
          this.active.delete(job.id);
        }
      }
    });
    return job;
  }
  cancel(id: string) {
    const job = this.get<Job>("job", id);
    const controller = this.active.get(id);
    if (controller) {
      controller.abort();
      job.status = "stopping";
      this.put("job", job);
    }
    return job;
  }
  async scan(rootId: string) {
    const root = this.get<Root>("root", rootId);
    await this.validateRoot(root);
    return this.start("scan", async (signal, job) => {
      root.scanStatus = "running";
      this.put("root", root);
      this.write(
        "DELETE FROM records WHERE kind IN ('file-stage','finding-stage') AND json_extract(value,'$.rootId')=?",
        rootId,
      );
      const finding = (
        title: string,
        detail: string,
        location: string,
        severity = "info",
      ) =>
        this.put("finding-stage", {
          id: randomUUID(),
          rootId,
          title,
          detail,
          path: location,
          severity,
        });
      let inheritedRepo = false;
      for (
        let dir = root.path;
        dir !== path.dirname(dir);
        dir = path.dirname(dir)
      ) {
        if (await isRepository(dir)) {
          inheritedRepo = true;
          break;
        }
      }
      const walk = async (relative: string, repo: boolean): Promise<void> => {
        signal.throwIfAborted();
        const dir = path.join(root.path, relative);
        if ((await fs.realpath(dir)) !== dir || !within(root.path, dir)) {
          finding(
            "Skipped symlink directory",
            "Directory changed or escapes root",
            dir,
          );
          return;
        }
        let entries;
        try {
          entries = await fs.readdir(dir, { withFileTypes: true });
        } catch {
          finding(
            "Cannot read folder",
            "Permission denied or folder unavailable",
            dir,
            "warning",
          );
          return;
        }
        repo = repo || entries.some((e) => repositoryMarkers.includes(e.name));
        for (const entry of entries) {
          signal.throwIfAborted();
          const rel = path.join(relative, entry.name),
            full = path.join(root.path, rel);
          if (
            entry.isSymbolicLink() ||
            protectedNames.has(entry.name) ||
            bundle.test(entry.name) ||
            secret.test(entry.name)
          ) {
            finding(
              "Protected item skipped",
              "Symlink, credential, cloud placeholder or protected package",
              full,
            );
            continue;
          }
          if (entry.isDirectory()) {
            if (
              [
                "node_modules",
                ".next",
                "dist",
                "build",
                "__pycache__",
                ".cache",
              ].includes(entry.name)
            ) {
              finding(
                "Generated folder candidate",
                "May be regenerable; inspect the owning project before cleanup. Not automatically scanned or deleted.",
                full,
              );
              continue;
            }
            await walk(rel, repo);
          } else if (entry.isFile()) {
            try {
              const identity = await this.inspect(root, rel, signal);
              const record: FileRecord = {
                ...identity,
                id: randomUUID(),
                rootId,
                path: full,
                relativePath: rel,
                category: localCategory(entry.name),
                modifiedAt: new Date(
                  Number(identity.mtime.split(":")[0]) * 1000,
                ).toISOString(),
              };
              if (repo)
                record.protectedReason =
                  "Repository content: no organization or cleanup permitted";
              if (
                /backup/i.test(rel) ||
                [".bak", ".backup"].includes(path.extname(rel))
              )
                record.protectedReason =
                  "Backup: coverage and restore have not been proven";
              this.put("file-stage", record);
              job.progress++;
              this.put("job", job);
              if (identity.size > 500 * 1024 * 1024)
                finding("Large file", "Large does not mean disposable", full);
              if (record.category === "screenshot")
                finding(
                  "Screenshot for review",
                  "Age and filename do not prove that this screenshot is no longer useful.",
                  full,
                );
            } catch (e) {
              if (signal.aborted || this.degraded) throw e;
              finding(
                "File not inspected",
                "Changed, inaccessible or cloud-only file; left untouched",
                full,
                "warning",
              );
            }
          }
        }
      };
      try {
        await walk("", inheritedRepo);
        await this.validateRoot(root);
        signal.throwIfAborted();
        const storage = await fs.statfs(root.path);
        finding(
          "Volume storage",
          `${storage.bavail * storage.bsize} bytes currently available. Quarantine preserves data and does not reclaim space.`,
          root.path,
          storage.bavail * storage.bsize < 5 * 1024 ** 3 ? "warning" : "info",
        );
        const staged = this.list<FileRecord>("file-stage").filter(
          (f) => f.rootId === rootId,
        );
        for (const report of analyzeCatalog(rootId, staged))
          this.put("finding-stage", report);
        const textSources: { path: string; text: string }[] = [];
        for (const file of staged
          .filter(
            (f) =>
              f.size <= 262144 &&
              /\.(md|txt|json|js|ts|jsx|tsx|css|html|py|swift|yaml|yml)$/i.test(
                f.relativePath,
              ),
          )
          .slice(0, 500)) {
          signal.throwIfAborted();
          try {
            const result = await run(
              native,
              ["text", root.path, file.relativePath, root.dev, root.ino],
              { signal, maxBuffer: 300000 },
            );
            textSources.push({ path: file.relativePath, text: result.stdout });
          } catch (e) {
            if (signal.aborted) throw e;
            finding(
              "Reference source not read",
              "Skipped changed, binary or inaccessible text; reference coverage incomplete",
              file.path,
            );
          }
        }
        for (const report of referenceEvidence(staged, textSources).slice(
          0,
          500,
        ))
          this.put("finding-stage", report);
        try {
          this.db.exec("BEGIN IMMEDIATE");
          this.write(
            "DELETE FROM records WHERE kind IN ('file','finding') AND json_extract(value,'$.rootId')=?",
            rootId,
          );
          this.write(
            "UPDATE records SET kind=CASE kind WHEN 'file-stage' THEN 'file' ELSE 'finding' END WHERE kind IN ('file-stage','finding-stage') AND json_extract(value,'$.rootId')=?",
            rootId,
          );
          this.db.exec("COMMIT");
          root.scanStatus = "complete";
        } catch (e) {
          this.degraded = true;
          try {
            this.db.exec("ROLLBACK");
          } catch {
            /* Original storage failure remains authoritative. */
          }
          throw e;
        }
      } catch (e) {
        root.scanStatus = signal.aborted ? "cancelled" : "failed";
        throw e;
      } finally {
        this.put("root", root);
      }
    });
  }
  duplicates() {
    const map = new Map<string, FileRecord[]>();
    for (const f of this.list<FileRecord>("file")) {
      const arr = map.get(f.hash) || [];
      arr.push(f);
      map.set(f.hash, arr);
    }
    return [...map.entries()]
      .filter(([, f]) => f.length > 1)
      .map(([hash, files]) => ({
        hash,
        files,
        logicalBytes:
          files[0].size *
          (new Set(files.map((f) => `${f.dev}:${f.ino}`)).size - 1),
      }));
  }
  async makePlan(kind: unknown, ids: unknown) {
    if (this.degraded)
      throw Error("Storage journal degraded; restart after resolving storage");
    if (this.active.size || this.mutation)
      throw Error("Wait for active work before planning");
    if (kind !== "quarantine" && kind !== "organize")
      throw Error("Unsupported plan kind");
    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      ids.length > 100 ||
      new Set(ids).size !== ids.length ||
      ids.some((x) => typeof x !== "string")
    )
      throw Error("Select 1–100 unique files");
    const files = ids.map((id) => this.get<FileRecord>("file", id));
    const root = this.get<Root>("root", files[0].rootId);
    await this.validateRoot(root);
    const id = randomUUID();
    const items: Item[] = [];
    for (const f of files) {
      if (f.rootId !== root.id)
        throw Error("A plan must stay within one root and volume");
      if (f.protectedReason) throw Error(f.protectedReason);
      await this.assertUnprotected(root, f.relativePath);
      const identity = await this.inspect(root, f.relativePath);
      if (identity.dev !== root.dev)
        throw Error("Cross-volume changes are not enabled");
      if (!this.identical(identity, f))
        throw Error("File changed since scan. Rescan first.");
      const folder =
        kind === "quarantine" ? ".jev-mac-quarantine" : "_JEV_Organized";
      const category = f.category.replace(/[^a-z-]/g, "") || "other";
      items.push({
        fileId: f.id,
        source: f.relativePath,
        destination: path.join(folder, id, category, f.relativePath),
        reason:
          kind === "quarantine"
            ? "User-selected recoverable quarantine. Does not free disk space."
            : "Organized copy; original retained.",
        identity,
      });
    }
    const plan: Plan = {
      id,
      rootId: root.id,
      kind,
      status: "pending",
      items,
      createdAt: now(),
    };
    this.put("plan", plan);
    return plan;
  }
  identical(a: Identity, b: Identity) {
    return ["dev", "ino", "size", "mtime", "hash"].every(
      (k) => a[k as keyof Identity] === b[k as keyof Identity],
    );
  }
  async assertUnprotected(root: Root, relative: string) {
    if (
      relative
        .split(path.sep)
        .some((p) => protectedNames.has(p) || bundle.test(p) || secret.test(p))
    )
      throw Error("Protected item");
    for (
      let dir = path.dirname(path.join(root.path, relative));
      dir !== path.dirname(dir);
      dir = path.dirname(dir)
    ) {
      if (await isRepository(dir)) throw Error("Repository content protected");
    }
  }
  async nativeOp(
    mode: string,
    root: Root,
    source: string,
    destination: string,
    identity: Identity,
  ) {
    await run(
      native,
      [
        mode,
        root.path,
        source,
        destination,
        identity.dev,
        identity.ino,
        String(identity.size),
        identity.mtime,
        identity.hash,
        root.dev,
        root.ino,
      ],
      { maxBuffer: 8192 },
    );
  }
  approve(action: "apply" | "restore", id: string, confirmation: string) {
    if (confirmation !== id) throw Error("Exact approval required");
    for (const [key, g] of this.grants)
      if (g.expires < Date.now()) this.grants.delete(key);
    const target = this.get(action === "apply" ? "plan" : "operation", id);
    const token = randomUUID();
    this.grants.set(token, {
      action,
      id,
      expires: Date.now() + 60000,
      digest: JSON.stringify(target),
    });
    return token;
  }
  private consumeGrant(action: string, id: string, token: string) {
    const grant = this.grants.get(token);
    this.grants.delete(token);
    if (
      !grant ||
      grant.action !== action ||
      grant.id !== id ||
      grant.expires < Date.now()
    )
      throw Error("Fresh single-use approval required");
    if (
      grant.digest !==
      JSON.stringify(this.get(action === "apply" ? "plan" : "operation", id))
    )
      throw Error("Approved plan changed; fresh approval required");
  }
  async apply(planId: string, grant: string) {
    this.consumeGrant("apply", planId, grant);
    const plan = this.get<Plan>("plan", planId);
    if (plan.status !== "pending") throw Error("Plan is not pending");
    if (Date.now() - Date.parse(plan.createdAt) > 15 * 60 * 1000)
      throw Error("Plan expired. Create a new preview.");
    const root = this.get<Root>("root", plan.rootId);
    await this.validateRoot(root);
    return this.start("apply", async (signal, job) => {
      plan.status = "applying";
      this.put("plan", plan);
      this.mutation = true;
      try {
        // Validate the whole plan before the first mutation.
        for (const item of plan.items) {
          signal.throwIfAborted();
          await this.assertUnprotected(root, item.source);
          if (
            !this.identical(
              await this.inspect(root, item.source, signal),
              item.identity,
            )
          )
            throw Error("Stale plan; file changed");
        }
        for (const item of plan.items) {
          if (signal.aborted) break;
          await this.validateRoot(root);
          await this.assertUnprotected(root, item.source);
          const op: Operation = {
            id: randomUUID(),
            planId,
            rootId: root.id,
            kind: plan.kind,
            source: item.source,
            destination: item.destination,
            status: "prepared",
            identity: item.identity,
          };
          this.put("operation", op);
          try {
            await this.nativeOp(
              plan.kind === "quarantine" ? "move" : "copy",
              root,
              item.source,
              item.destination,
              item.identity,
            );
            op.status = "complete";
            if (plan.kind === "quarantine") this.remove("file", item.fileId);
          } catch {
            op.status = "needs-recovery";
            op.error = `Operation refused or interrupted. Original/destination preserved.${plan.kind === "organize" ? ` Partial artifact, if present: ${op.destination}.jev-part. Review this exact path; do not delete the original.` : ""}`;
            throw Error(op.error);
          } finally {
            this.put("operation", op);
          }
          job.progress++;
          this.put("job", job);
        }
        plan.status = signal.aborted ? "cancelled" : "complete";
      } catch (e) {
        plan.status = "needs-review";
        throw e;
      } finally {
        try {
          this.put("plan", plan);
        } finally {
          this.mutation = false;
        }
      }
    });
  }
  async restore(operationId: string, grant: string) {
    this.consumeGrant("restore", operationId, grant);
    const op = this.get<Operation>("operation", operationId);
    if (
      op.kind !== "quarantine" ||
      !["complete", "prepared", "needs-recovery"].includes(op.status)
    )
      throw Error("Only quarantined files can be restored");
    const root = this.get<Root>("root", op.rootId);
    await this.validateRoot(root);
    return this.start("restore", async (_signal, job) => {
      this.mutation = true;
      try {
        const current = await this.inspect(root, op.destination);
        if (!this.identical(current, op.identity))
          throw Error("Quarantine content changed. Manual review required.");
        op.status = "restoring";
        op.phase = "restore";
        this.put("operation", op);
        await this.nativeOp("move", root, op.destination, op.source, current);
        op.status = "restored";
        job.progress = 1;
      } catch {
        op.status = "needs-recovery";
        op.error =
          "Restore refused. Destination may exist or content changed; no overwrite performed.";
        throw Error(op.error);
      } finally {
        try {
          this.put("operation", op);
        } finally {
          this.mutation = false;
        }
      }
    });
  }
  async reconcile() {
    for (const op of this.list<Operation>("operation")) {
      if (!["prepared", "restoring", "needs-recovery"].includes(op.status))
        continue;
      const root = this.get<Root>("root", op.rootId);
      try {
        await this.validateRoot(root);
        const src = await this.inspect(root, op.source).catch(() => null),
          dst = await this.inspect(root, op.destination).catch(() => null);
        if (
          op.kind === "quarantine" &&
          dst &&
          this.identical(dst, op.identity) &&
          !src
        ) {
          op.status = "complete";
          op.error = undefined;
        } else if (
          op.kind === "quarantine" &&
          src &&
          this.identical(src, op.identity) &&
          !dst
        ) {
          op.status = op.phase === "restore" ? "restored" : "not-applied";
          op.error = undefined;
        } else if (
          op.kind === "organize" &&
          src &&
          this.identical(src, op.identity) &&
          dst &&
          dst.hash === src.hash
        ) {
          op.status = "complete";
          op.error = undefined;
        } else {
          op.status = "needs-recovery";
          op.error =
            "Ambiguous interrupted operation; all surviving files retained.";
        }
      } catch {
        op.status = "needs-recovery";
        op.error = "Root or files unavailable; no automatic mutation.";
      }
      this.put("operation", op);
    }
  }
  state(search = "", offset = 0, limit = 100) {
    const all = this.list<FileRecord>("file");
    const filtered = all.filter((f) =>
      `${f.relativePath} ${f.category}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
    const duplicates = this.duplicates();
    const roots = this.list<Root>("root");
    return {
      roots,
      jobs: this.list<Job>("job").slice(0, 100),
      files: filtered.slice(offset, offset + limit),
      fileTotal: filtered.length,
      duplicates: duplicates
        .slice(0, 100)
        .map((g) => ({ ...g, files: g.files.slice(0, 100) })),
      findings: this.list("finding").slice(0, 300),
      plans: this.list<Plan>("plan").slice(0, 100),
      operations: this.list<Operation>("operation").slice(0, 300),
      summary: {
        files: all.length,
        bytes: all.reduce((n, f) => n + f.size, 0),
        duplicateGroups: duplicates.length,
        incompleteRoots: roots
          .filter((r) => r.scanStatus && r.scanStatus !== "complete")
          .map((r) => r.path),
        degraded: this.degraded,
      },
    };
  }
  async demo() {
    const rootPath = await fs.mkdtemp("/private/tmp/jev-mac-demo-");
    await fs.mkdir(path.join(rootPath, "Project assets"));
    await fs.mkdir(path.join(rootPath, "Downloads"));
    await fs.writeFile(
      path.join(rootPath, "Project assets", "brief.md"),
      "# Demo project\nSynthetic material for JEV-MAC.\n",
    );
    await fs.copyFile(
      path.join(rootPath, "Project assets", "brief.md"),
      path.join(rootPath, "Downloads", "brief-copy.md"),
    );
    await fs.writeFile(
      path.join(rootPath, "Downloads", "Screenshot demo.txt"),
      "Synthetic screenshot review example, not an image.\n",
    );
    await fs.writeFile(
      path.join(rootPath, "Downloads", "notes.txt"),
      "Keep original notes.\n",
    );
    return this.addRoot(rootPath);
  }
  async close() {
    for (const c of this.active.values()) c.abort();
    while (this.active.size) await new Promise((r) => setTimeout(r, 20));
    this.db.close();
  }
}
