import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { Engine, type FileRecord, type Job } from "../src/core.ts";

async function fixture(t: import("node:test").TestContext) {
  const base = await fs.mkdtemp("/private/tmp/jev-dupes-");
  await fs.mkdir(path.join(base, "data"));
  await fs.mkdir(path.join(base, "files"));
  const engine = new Engine(path.join(base, "data"));
  const root = await engine.addRoot(path.join(base, "files"));
  await fs.writeFile(path.join(root.path, "original.txt"), "shared content");
  await fs.writeFile(path.join(root.path, "copy.txt"), "shared content");
  await engine.scan(root.id);
  await idle(engine);
  t.after(async () => {
    await engine.close();
    await fs.rm(base, { recursive: true, force: true });
  });
  const records = engine.list<FileRecord>("file");
  return {
    engine,
    root,
    keep: records.find((f) => f.relativePath === "original.txt")!,
    copy: records.find((f) => f.relativePath === "copy.txt")!,
  };
}
async function idle(engine: Engine) {
  for (let i = 0; i < 1000 && engine.active.size; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(engine.active.size, 0);
}
test("duplicate plans exclude and revalidate the chosen keeper before mutation", async (t) => {
  const { engine, root, keep, copy } = await fixture(t);
  await assert.rejects(
    engine.makeDuplicatePlan(keep.id, [keep.id]),
    /different copy/,
  );
  const plan = await engine.makeDuplicatePlan(keep.id, [copy.id]);
  assert.equal(plan.keeper?.source, "original.txt");
  assert.equal(plan.items[0].source, "copy.txt");
  await fs.writeFile(path.join(root.path, "original.txt"), "now different");
  const job = await engine.apply(
    plan.id,
    engine.approve("apply", plan.id, plan.id),
  );
  await idle(engine);
  assert.equal(engine.get<Job>("job", job.id).status, "failed");
  assert.match(engine.get<Job>("job", job.id).error!, /selected to keep/);
  assert.equal(
    await fs.readFile(path.join(root.path, "copy.txt"), "utf8"),
    "shared content",
  );
  assert.equal(engine.list("operation").length, 0);
});
test("ignore is durable catalog metadata and resets when group membership changes", async (t) => {
  const { engine, root, keep } = await fixture(t);
  engine.ignoreDuplicate(keep.hash, true);
  assert.equal(engine.duplicates()[0].ignored, true);
  assert.equal(
    engine.list<{ ignored: boolean }>("duplicate-review")[0].ignored,
    true,
  );
  await engine.scan(root.id);
  await idle(engine);
  assert.equal(engine.duplicates()[0].ignored, true);
  await fs.writeFile(path.join(root.path, "third.txt"), "shared content");
  await engine.scan(root.id);
  await idle(engine);
  assert.equal(engine.duplicates()[0].ignored, false);
  engine.ignoreDuplicate(keep.hash, true);
  engine.ignoreDuplicate(keep.hash, false);
  assert.equal(engine.duplicates()[0].ignored, false);
});
test("named harness files are protected even outside a repository", async (t) => {
  const { engine, root } = await fixture(t);
  await fs.writeFile(path.join(root.path, "AGENTS.md"), "instructions");
  await fs.writeFile(path.join(root.path, "CLAUDE.md"), "instructions");
  await engine.scan(root.id);
  await idle(engine);
  const files = engine
    .state()
    .files.filter((f) => f.relativePath.endsWith(".md"));
  assert.equal(files.length, 2);
  assert.ok(files.every((f) => f.protectedReason));
  await assert.rejects(
    engine.makePlan("quarantine", [files[0].id]),
    /instruction file/,
  );
  await assert.rejects(
    engine.makeDuplicatePlan(files[0].id, [files[1].id]),
    /instruction file/,
  );
});
