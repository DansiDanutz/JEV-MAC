import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Receipt } from "./receipts.ts";
export async function routerHealth(receipts: Receipt[], home = os.homedir(), temp = os.tmpdir()) {
  let version: string | null = null;
  try {
    const file = path.join(home, ".npm-global/lib/node_modules/jev-router/package.json"), stat = await fs.lstat(file);
    if (stat.isFile() && !stat.isSymbolicLink() && stat.size < 65536) {
      const data = JSON.parse(await fs.readFile(file, "utf8"));
      if (data.name === "jev-router" && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(data.version)) version = data.version;
    }
  } catch { /* Missing installation is unknown. */ }
  let directoryMode: string | null = null;
  let checkedFiles = 0, insecureFiles = 0, skippedFiles = 0, complete = false;
  try {
    const dir = path.join(temp, "jev-claude"), stat = await fs.lstat(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error("Unsafe directory");
    directoryMode = (stat.mode & 0o777).toString(8);
    const entries = (await fs.readdir(dir)).filter(n => n.endsWith(".json"));
    complete = entries.length <= 100;
    for (const entry of entries.slice(0, 100)) {
      const stat = await fs.lstat(path.join(dir, entry));
      if (!stat.isFile() || stat.isSymbolicLink()) { skippedFiles++; continue; }
      checkedFiles++; if (stat.mode & 0o077) insecureFiles++;
    }
  } catch { complete = false; }
  const router = receipts.filter(r => r.source === "router").sort((a,b) => b.occurredAt.localeCompare(a.occurredAt));
  return { checkedAt: new Date().toISOString(), version,
    privacy: { directoryMode, checkedFiles, insecureFiles, skippedFiles, complete,
      restricted: directoryMode === "700" && insecureFiles === 0 && skippedFiles === 0 && complete },
    recordedDecisions: router.length,
    recent: router.slice(0, 5).map(r => ({ at: r.occurredAt, harness: r.harness ?? "unknown", model: r.model ?? "unknown", tokens: r.inputTokens + r.outputTokens })),
  };
}
