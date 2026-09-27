import test from "node:test";
import assert from "node:assert/strict";
import { analyzeCatalog, referenceEvidence } from "../src/doctor.ts";
import type { FileRecord } from "../src/core.ts";
test("Doctor reports content overlap without calling a newer folder disposable", () => {
  const make = (relativePath: string, hash: string) =>
    ({
      id: relativePath,
      rootId: "root",
      relativePath,
      path: relativePath,
      hash,
      size: 20,
      category: "document",
    }) as FileRecord;
  const reports = analyzeCatalog("root", [
    make("project-v1/a.txt", "one"),
    make("project-v2/a.txt", "one"),
    make("project-v2/b.txt", "two"),
  ]);
  const overlap = reports.find(
    (r) => r.title === "Overlapping folder versions",
  );
  assert.ok(overlap);
  assert.match(
    overlap.detail,
    /project-v2 ↔ project-v1: 1 shared content hashes, 1 unique to first, 0 unique to second/,
  );
  assert.match(overlap.detail, /Neither folder is approved for deletion/);
});
test("local reference analysis identifies mentions without asserting orphan safety", () => {
  const files = [
    {
      id: "one",
      rootId: "r",
      path: "/fixture/logo.png",
      relativePath: "logo.png",
      category: "image",
    },
    {
      id: "two",
      rootId: "r",
      path: "/fixture/unused.png",
      relativePath: "unused.png",
      category: "image",
    },
  ] as FileRecord[];
  const findings = referenceEvidence(files, [
    { path: "index.html", text: '<img src="./logo.png?width=2">' },
  ]);
  assert.equal(findings[0].title, "Media filename referenced");
  assert.match(findings[0].detail, /index.html/);
  assert.match(findings[1].detail, /NOT permission to delete/);
});
