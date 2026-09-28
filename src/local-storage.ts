import { promises as fs } from "node:fs";
import type { FileRecord, Root } from "./core.ts";

export function storageCandidates(files: FileRecord[], now = Date.now()) {
  return files.map(file => {
    const old = Number.isFinite(Date.parse(file.modifiedAt)) && now - Date.parse(file.modifiedAt) > 180 * 86400000;
    const compressed = /\.(zip|gz|xz|7z|rar|jpg|jpeg|png|mp4|mov|dmg)$/i.test(file.relativePath);
    const kind = file.protectedReason ? "Protected" : /backup|\.bak$|\.backup$/i.test(file.relativePath) ? "Backup review" : old ? "Archive review" : compressed ? "Already compressed" : "Compression review";
    return { id: file.id, path: file.relativePath, rootId: file.rootId, bytes: file.size, kind,
      reason: file.protectedReason || (kind === "Backup review" ? "Name suggests a backup; age and filename do not prove another recoverable copy exists." : old ? "Not modified in 180 days. This does not prove it is unused." : compressed ? "This format usually compresses poorly. Review duplicates instead." : "Compression benefit is unknown until an archive is created and verified."),
      protected: Boolean(file.protectedReason) };
  }).sort((a, b) => b.bytes - a.bytes).slice(0, 100);
}

export async function localStorageReport(files: FileRecord[], roots: Root[], volumePath: string) {
  let disk: { total: number; available: number; reserve: number; belowReserve: boolean } | null = null;
  try {
    const s = await fs.statfs(volumePath);
    const total = s.blocks * s.bsize, available = s.bavail * s.bsize;
    const reserve = Math.max(20 * 1024 ** 3, total * 0.1);
    disk = { total, available, reserve, belowReserve: available < reserve };
  } catch { /* Unavailable is not zero. */ }
  return { checkedAt: new Date().toISOString(), disk, roots, cataloged: files.length,
    candidates: storageCandidates(files),
    scope: "Connected-folder catalog only. No whole-Mac scan, app uninstall, backup purge or project removal has run.",
    limitations: ["Logical file sizes are not reclaimable space; APFS clones, hard links and snapshots can share blocks.", "Rescan connected folders before planning. Files may have changed since the catalog was built.", "GitHub sync alone does not preserve ignored files, secrets, local databases, LFS objects or unpushed branches."] };
}
