import { test } from "node:test";
import assert from "node:assert/strict";
import { storageCandidates, localStorageReport } from "../src/local-storage.ts";
import type { FileRecord } from "../src/core.ts";
const file = (extra: Partial<FileRecord> = {}): FileRecord => ({ id: "1", rootId: "r", path: "/synthetic/a.txt", relativePath: "a.txt", category: "document", modifiedAt: "2020-01-01", size: 100, allocated: 100, dev: "1", ino: "1", mtime: "0", hash: "abc", links: 1, ...extra });
test("storage protection takes precedence over age or backup names", () => {
  const result = storageCandidates([file({ relativePath: "backup.txt", protectedReason: "Active repository" })]);
  assert.equal(result[0].kind, "Protected");
  assert.equal(result[0].protected, true);
});
test("storage candidates are bounded and never claim safe deletion", () => {
  const result = storageCandidates(Array.from({ length: 105 }, (_, i) => file({ id: String(i), size: i })));
  assert.equal(result.length, 100); assert.equal(result[0].bytes, 104);
  assert.match(result[0].reason, /does not prove/);
});
test("missing volume reports unknown rather than zero or scanning", async () => {
  const report = await localStorageReport([], [], "/nonexistent-jev-storage-fixture");
  assert.equal(report.disk, null); assert.equal(report.cataloged, 0);
  assert.deepEqual(report.candidates, []);
});
