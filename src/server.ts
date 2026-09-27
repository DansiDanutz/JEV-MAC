import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Engine, type FileRecord, type Root } from "./core.ts";
import { buildPayload, classify, type JevPayload } from "./jev.ts";
import { pickFolder } from "./folder-picker.ts";

const project = fileURLToPath(new URL("../", import.meta.url));
const allowedAgent = new Set([
  "/api/state",
  "/api/scan",
  "/api/cancel",
  "/api/plan",
  "/api/classify-preview",
]);
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function startServer(
  options: {
    dataDir?: string;
    port?: number;
    apiKey?: string;
    folderPicker?: (location: unknown) => Promise<string | null>;
  } = {},
) {
  const dataDir = path.resolve(
    options.dataDir ||
      process.env.JEV_MAC_DATA_DIR ||
      path.join(project, "runtime"),
  );
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  await fs.chmod(dataDir, 0o700);
  // One daemon owns this catalog. A live lock is never stolen.
  const lockPath = path.join(dataDir, "daemon.lock");
  async function acquire() {
    try {
      return await fs.open(lockPath, "wx", 0o600);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const pid = Number(await fs.readFile(lockPath, "utf8"));
      if (!Number.isInteger(pid) || pid < 1)
        throw Error("Invalid daemon lock; inspect it manually");
      try {
        process.kill(pid, 0);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ESRCH") {
          await fs.unlink(lockPath);
          return fs.open(lockPath, "wx", 0o600);
        }
        throw err;
      }
      throw Error("JEV-MAC is already running for this catalog");
    }
  }
  const lock = await acquire();
  await lock.writeFile(String(process.pid));
  await lock.close();
  const engine = new Engine(dataDir);
  let pickerOpen = false;
  await engine.reconcile();
  const browserToken = randomBytes(32).toString("hex"),
    agentToken = randomBytes(32).toString("hex");
  let apiKey =
    options.apiKey ||
    process.env.TYPESAFE_API_KEY ||
    process.env.JEV_API_KEY ||
    "";
  if (!apiKey && process.env.JEV_MAC_KEY_FILE) {
    const keyPath = path.resolve(process.env.JEV_MAC_KEY_FILE);
    const stat = await fs.lstat(keyPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
      throw Error("Key file must be a regular private file (chmod 600)");
    const content = await fs.readFile(keyPath, "utf8");
    apiKey =
      content
        .match(/^(?:JEV_API_KEY|TYPESAFE_API_KEY)\s*=\s*([^\r\n]+)$/m)?.[1]
        ?.trim()
        .replace(/^['"]|['"]$/g, "") || "";
  }
  if (apiKey === "PASTE_KEY_HERE") apiKey = "";
  const previews = new Map<
    string,
    { payload: JevPayload; expires: number; fileIds: string[] }
  >();
  const send = (res: http.ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(data));
  };
  let origin = "";
  let port = 0;
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    try {
      if (req.headers.host !== `127.0.0.1:${port}`)
        return send(res, 403, {
          error: "Invalid host. Use the local launch URL.",
        });
      if (req.headers.origin && req.headers.origin !== origin)
        return send(res, 403, { error: "Cross-origin requests are forbidden" });
      const url = new URL(req.url || "/", origin);
      if (url.pathname.startsWith("/api/")) {
        const token = (req.headers.authorization || "").replace(/^Bearer /, "");
        const browser = equal(token, browserToken),
          agent = equal(token, agentToken);
        if (!browser && !agent)
          return send(res, 401, {
            error: "Unlock this dashboard with its local session token.",
          });
        if (agent && !allowedAgent.has(url.pathname))
          return send(res, 403, {
            error: "This action requires human approval in the dashboard",
          });
        if (req.method === "GET" && url.pathname === "/api/state") {
          const offset = Math.max(
              0,
              Number(url.searchParams.get("offset")) || 0,
            ),
            limit = Math.min(
              200,
              Math.max(1, Number(url.searchParams.get("limit")) || 100),
            );
          return send(res, 200, {
            ...engine.state(
              url.searchParams.get("search") || "",
              offset,
              limit,
            ),
            settings: {
              jevConfigured: Boolean(apiKey),
              maxFilesPerRequest: 20,
              maxRequestsPerDay: 20,
              requestsToday: usageToday(),
              privacy:
                "Only filenames, extensions, sizes and dates leave this Mac after explicit payload approval. No content or absolute paths.",
            },
          });
        }
        if (req.method !== "POST")
          return send(res, 405, { error: "Method not allowed" });
        if (browser && req.headers.origin !== origin)
          return send(res, 403, {
            error: "Browser action requires matching Origin",
          });
        if (!req.headers["content-type"]?.startsWith("application/json"))
          return send(res, 415, { error: "JSON required" });
        let text = "";
        for await (const chunk of req) {
          text += chunk;
          if (text.length > 65536)
            return send(res, 413, { error: "Request too large" });
        }
        const body = JSON.parse(text || "{}");
        let result: unknown;
        switch (url.pathname) {
          case "/api/roots":
            result = await engine.addRoot(body.path);
            break;
          case "/api/folder-picker": {
            if (pickerOpen)
              throw Error(
                "A folder picker is already open. Choose or cancel in that window.",
              );
            pickerOpen = true;
            try {
              const selected = await (options.folderPicker || pickFolder)(
                body.location,
              );
              result = { path: selected, cancelled: !selected };
            } finally {
              pickerOpen = false;
            }
            break;
          }
          case "/api/demo":
            result = await engine.demo();
            break;
          case "/api/scan":
            result = await engine.scan(body.rootId);
            break;
          case "/api/cancel":
            result = engine.cancel(body.jobId);
            break;
          case "/api/plan":
            result = await engine.makePlan(body.kind, body.fileIds);
            break;
          case "/api/duplicate-plan":
            result = await engine.makeDuplicatePlan(
              body.keepFileId,
              body.fileIds,
            );
            break;
          case "/api/duplicate-ignore":
            result = engine.ignoreDuplicate(body.hash, body.ignored);
            break;
          case "/api/apply":
            result = await engine.apply(
              body.planId,
              engine.approve("apply", body.planId, body.confirmation),
            );
            break;
          case "/api/restore":
            result = await engine.restore(
              body.operationId,
              engine.approve("restore", body.operationId, body.confirmation),
            );
            break;
          case "/api/classify-preview": {
            if (
              !Array.isArray(body.fileIds) ||
              body.fileIds.length < 1 ||
              body.fileIds.length > 20 ||
              new Set(body.fileIds).size !== body.fileIds.length
            )
              throw Error("Select 1–20 unique files");
            const files = body.fileIds.map((id: string) =>
              engine.get<FileRecord>("file", id),
            );
            if (files.some((f: FileRecord) => f.protectedReason))
              throw Error("Protected files cannot be sent for classification");
            const payload = buildPayload(
              files.map((f: FileRecord) => ({
                id: f.id,
                name: path.basename(f.path),
                extension: path.extname(f.path),
                size: f.size,
                modifiedAt: f.modifiedAt,
              })),
            );
            const previewId = randomBytes(16).toString("hex");
            for (const [id, v] of previews)
              if (v.expires < Date.now()) previews.delete(id);
            if (previews.size >= 100) throw Error("Too many pending previews");
            previews.set(previewId, {
              payload,
              expires: Date.now() + 5 * 60 * 1000,
              fileIds: body.fileIds,
            });
            result = { payload, previewId };
            break;
          }
          case "/api/classify": {
            if (body.consent !== true)
              throw Error("Explicit payload consent required");
            const preview = previews.get(body.previewId);
            if (!preview || preview.expires < Date.now())
              throw Error("Preview expired; review a new payload");
            if (!apiKey) throw Error("Jev key not configured. See Settings.");
            if (usageToday() >= 20)
              throw Error(
                "Daily request ceiling reached (20). No automatic retries.",
              );
            result = engine.start("classify", async (signal, job) => {
              previews.delete(body.previewId);
              const cacheId = createHash("sha256")
                .update(JSON.stringify(preview.payload))
                .digest("hex");
              let output;
              try {
                output = engine.get<{
                  id: string;
                  output: Awaited<ReturnType<typeof classify>>;
                }>("jev-cache", cacheId).output;
              } catch {
                const usage = {
                  id: randomBytes(16).toString("hex"),
                  date: new Date().toISOString().slice(0, 10),
                };
                engine.put("jev-request", usage);
                output = await classify(preview.payload, { apiKey, signal });
                engine.put("jev-cache", { id: cacheId, output } as {
                  id: string;
                });
              }
              for (const answer of output.results) {
                signal.throwIfAborted();
                const f = engine.get<FileRecord>("file", answer.id);
                const root = engine.get<Root>("root", f.rootId);
                await engine.validateRoot(root);
                if (
                  !engine.identical(
                    await engine.inspect(root, f.relativePath, signal),
                    f,
                  )
                )
                  throw Error("File changed; classification not applied");
                engine.put("file", {
                  ...f,
                  category: answer.category,
                  classification: answer,
                });
                job.progress++;
                engine.put("job", job);
              }
            });
            break;
          }
          default:
            return send(res, 404, { error: "Unknown endpoint" });
        }
        return send(res, 200, result);
      }
      if (req.method !== "GET")
        return send(res, 405, { error: "Method not allowed" });
      const asset = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (!/^[a-zA-Z0-9_./-]+$/.test(asset) || asset.includes(".."))
        return send(res, 404, { error: "Not found" });
      const file = path.join(project, "dist", asset);
      const content = await fs.readFile(file);
      const mime: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".svg": "image/svg+xml",
      };
      res.setHeader(
        "Content-Type",
        mime[path.extname(file)] || "application/octet-stream",
      );
      res.end(content);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Request failed"; // Do not include provider bodies, native arguments or credentials.
      const safe = message.includes("Command failed")
        ? "Filesystem operation refused; files were left recoverable."
        : message;
      send(res, 400, {
        error: apiKey ? safe.split(apiKey).join("[REDACTED]") : safe,
      });
    }
  });
  function usageToday() {
    return engine
      .list<{ id: string; date: string }>("jev-request")
      .filter((r) => r.date === new Date().toISOString().slice(0, 10)).length;
  }
  let preferred = options.port ?? Number(process.env.JEV_MAC_PORT || 0);
  if (!preferred) {
    try {
      preferred = JSON.parse(
        await fs.readFile(path.join(dataDir, "server.json"), "utf8"),
      ).port;
    } catch {
      /* first launch chooses OS-assigned port */
    }
  }
  await new Promise<void>((resolve, reject) => {
    const onError = (e: NodeJS.ErrnoException) => {
      if (e.code === "EADDRINUSE" && !options.port) {
        server.listen(0, "127.0.0.1");
      } else reject(e);
    };
    server.on("error", onError);
    server.listen(preferred, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  port = (server.address() as import("node:net").AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;
  await fs.writeFile(
    path.join(dataDir, "server.json"),
    JSON.stringify({ port, origin }),
    { mode: 0o600 },
  );
  await fs.writeFile(
    path.join(dataDir, "agent.json"),
    JSON.stringify({ origin, agentToken }),
    { mode: 0o600 },
  );
  const launchUrl = `${origin}/#token=${browserToken}`;
  await fs.writeFile(
    path.join(dataDir, "launch.html"),
    `<!doctype html><meta charset="utf-8"><title>Open JEV-MAC</title><p>Opening the local dashboard…</p><script>location.replace(${JSON.stringify(launchUrl)})</script>`,
    { mode: 0o600 },
  );
  return {
    engine,
    server,
    origin,
    browserToken,
    agentToken,
    dataDir,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await engine.close();
      await fs.unlink(lockPath);
    },
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  startServer()
    .then((app) => {
      console.log(
        `JEV-MAC listening at ${app.origin}. Open runtime/launch.html to unlock. No scan starts automatically.`,
      );
      let closing = false;
      const stop = () => {
        if (closing) return;
        closing = true;
        void app.close().then(() => process.exit(0));
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    })
    .catch(() => {
      console.error(
        "JEV-MAC could not start. Check runtime lock, port, build and private key-file permissions.",
      );
      process.exitCode = 1;
    });
}
