import path from "node:path";
import type { FileRecord } from "./core.ts";

export type DoctorFinding = {
  id: string;
  rootId: string;
  severity: string;
  title: string;
  detail: string;
  path?: string;
};
export function referenceEvidence(
  files: FileRecord[],
  sources: { path: string; text: string }[],
) {
  const media = files.filter((f) =>
    ["image", "video", "screenshot"].includes(f.category),
  );
  const byName = new Map<string, string[]>();
  for (const file of media) {
    const name = path.basename(file.relativePath).toLowerCase();
    const ids = byName.get(name) || [];
    ids.push(file.id);
    byName.set(name, ids);
  }
  const references = new Map<string, Set<string>>();
  for (const source of sources)
    for (const token of source.text.split(/[\s"'`()<>{}\[\];,]+/)) {
      let candidate = token.split(/[?#]/)[0];
      try {
        candidate = decodeURIComponent(candidate);
      } catch {
        /* Literal malformed URL is still checked. */
      }
      const ids = byName.get(
        candidate.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() || "",
      );
      for (const id of ids || []) {
        const paths = references.get(id) || new Set<string>();
        if (paths.size < 10) paths.add(source.path);
        references.set(id, paths);
      }
    }
  return media.map((file) => ({
    id: `references-${file.id}`,
    rootId: file.rootId,
    severity: "info",
    title: references.has(file.id)
      ? "Media filename referenced"
      : "No text reference found in bounded sample",
    path: file.path,
    detail: references.has(file.id)
      ? `Filename mentioned in: ${[...references.get(file.id)!].join(", ")}. Lexical evidence, not a full dependency graph.`
      : `Checked ${sources.length} small text files locally. Dynamic, external, binary and excluded references are unknown. This is NOT permission to delete.`,
  }));
}
/** Evidence only: no age-based deletion rules or claim that text search proves orphan status. */
export function analyzeCatalog(
  rootId: string,
  files: FileRecord[],
): DoctorFinding[] {
  const findings: DoctorFinding[] = [];
  const groups = new Map<string, FileRecord[]>();
  for (const file of files) {
    const folder = file.relativePath.split(path.sep)[0];
    if (!file.relativePath.includes(path.sep)) continue;
    const group = groups.get(folder) || [];
    group.push(file);
    groups.set(folder, group);
  }
  const add = (title: string, detail: string, location?: string) =>
    findings.push({
      id: `${rootId}-${findings.length}`,
      rootId,
      severity: "info",
      title,
      detail,
      path: location,
    });
  const ranked = [...groups.entries()].sort(
    (a, b) =>
      b[1].reduce((n, f) => n + f.size, 0) -
      a[1].reduce((n, f) => n + f.size, 0),
  );
  for (const [name, items] of ranked.slice(0, 10))
    add(
      "Folder storage review",
      `${name}: ${items.length} inspected files, ${items.reduce((n, f) => n + f.size, 0)} logical bytes. Excluded files are not counted; logical bytes are not guaranteed reclaimable space.`,
      name,
    );
  const limited = ranked.slice(0, 50);
  for (let i = 0; i < limited.length; i++)
    for (let j = i + 1; j < limited.length; j++) {
      const [left, a] = limited[i],
        [right, b] = limited[j];
      const ah = new Set(a.map((f) => f.hash)),
        bh = new Set(b.map((f) => f.hash));
      const common = [...ah].filter((h) => bh.has(h)).length;
      if (!common) continue;
      const aOnly = ah.size - common,
        bOnly = bh.size - common;
      add(
        aOnly === 0 && bOnly === 0
          ? "Matching inspected folder content"
          : "Overlapping folder versions",
        `${left} ↔ ${right}: ${common} shared content hashes, ${aOnly} unique to first, ${bOnly} unique to second. This is not backup verification: paths, metadata, excluded files and external references may differ. Neither folder is approved for deletion.`,
      );
      if (findings.length >= 60) return findings;
    }
  const media = files.filter((f) => ["image", "video"].includes(f.category));
  if (media.length)
    add(
      "Media reference status unknown",
      `${media.length} media files cataloged. Exact duplicates are detectable; visual similarity and project references have not been established. Do not interpret unreferenced-looking names as orphan proof.`,
    );
  return findings;
}
