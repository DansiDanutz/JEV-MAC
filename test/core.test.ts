import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import {
  Engine,
  type FileRecord,
  type Job,
  type Operation,
  type Plan,
  type Root,
} from "../src/core.ts";

type Fixture = {
  base: string;
  rootPath: string;
  dataPath: string;
  engine: Engine;
  root: Root;
};

async function fixture(t: TestContext): Promise<Fixture> {
  const base = await fs.mkdtemp("/private/tmp/jev-mac-core-");
  const rootPath = path.join(base, "fixture");
  const dataPath = path.join(base, "data");
  await fs.mkdir(rootPath);
  await fs.mkdir(dataPath);
  const engine = new Engine(dataPath);
  const root = await engine.addRoot(rootPath);
  t.after(async () => {
    await engine.close().catch(() => undefined);
    await fs.rm(base, { recursive: true, force: true });
  });
  return { base, rootPath, dataPath, engine, root };
}

async function waitForIdle(engine: Engine, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (engine.active.size > 0) {
    if (Date.now() > deadline)
      throw new Error("Engine job did not finish in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function scan(engine: Engine, root: Root): Promise<Job> {
  const started = await engine.scan(root.id);
  await waitForIdle(engine);
  return engine.get<Job>("job", started.id);
}

function fileByName(engine: Engine, name: string): FileRecord {
  const record = engine
    .state()
    .files.find((candidate) => candidate.relativePath === name);
  assert.ok(record, `Expected scanned file ${name}`);
  return record;
}

async function applyAndWait(engine: Engine, plan: Plan): Promise<Job> {
  const started = await engine.apply(
    plan.id,
    engine.approve("apply", plan.id, plan.id),
  );
  await waitForIdle(engine);
  return engine.get<Job>("job", started.id);
}

test("scan accounts for hardlinks without claiming duplicate savings", async (t) => {
  const { engine, root, rootPath } = await fixture(t);
  const contents = "same synthetic bytes";
  await fs.writeFile(path.join(rootPath, "original.txt"), contents);
  await fs.link(
    path.join(rootPath, "original.txt"),
    path.join(rootPath, "hardlink.txt"),
  );
  await fs.copyFile(
    path.join(rootPath, "original.txt"),
    path.join(rootPath, "copy.txt"),
  );

  assert.equal((await scan(engine, root)).status, "complete");
  const group = engine.duplicates().find(({ files }) => files.length === 3);
  assert.ok(group);
  assert.equal(
    new Set(group.files.map((file) => `${file.dev}:${file.ino}`)).size,
    2,
  );
  assert.equal(group.logicalBytes, Buffer.byteLength(contents));

  await fs.rm(path.join(rootPath, "copy.txt"));
  assert.equal((await scan(engine, root)).status, "complete");
  const hardlinksOnly = engine
    .duplicates()
    .find(({ files }) => files.length === 2);
  assert.ok(hardlinksOnly);
  assert.equal(hardlinksOnly.logicalBytes, 0);
});

test("a cancelled scan can be restarted cleanly", async (t) => {
  const { engine, root, rootPath } = await fixture(t);
  await Promise.all(
    Array.from({ length: 80 }, (_, index) =>
      fs.writeFile(
        path.join(rootPath, `item-${index}.txt`),
        "x".repeat(16_384),
      ),
    ),
  );

  const first = await engine.scan(root.id);
  engine.cancel(first.id);
  await waitForIdle(engine);
  assert.equal(engine.get<Job>("job", first.id).status, "cancelled");
  assert.equal(engine.active.size, 0);

  const second = await scan(engine, root);
  assert.equal(second.status, "complete");
  assert.equal(engine.state().fileTotal, 80);
});

test("scan skips symlinks and never catalogs their targets", async (t) => {
  const { base, engine, root, rootPath } = await fixture(t);
  const outside = path.join(base, "outside");
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, "outside.txt"), "must not be scanned");
  await fs.symlink(outside, path.join(rootPath, "escape"));
  await fs.writeFile(path.join(rootPath, "inside.txt"), "safe fixture");

  assert.equal((await scan(engine, root)).status, "complete");
  assert.deepEqual(
    engine.state().files.map((file) => file.relativePath),
    ["inside.txt"],
  );
  assert.ok(
    engine
      .state()
      .findings.some(
        (finding: any) => finding.path === path.join(rootPath, "escape"),
      ),
  );
});

test("repository, backup, and secret protections block unsafe planning", async (t) => {
  const { engine, root, rootPath } = await fixture(t);
  await fs.mkdir(path.join(rootPath, "project", ".git"), { recursive: true });
  await fs.writeFile(path.join(rootPath, "project", "main.ts"), "export {};");
  await fs.mkdir(path.join(rootPath, "snapshots"));
  await fs.writeFile(
    path.join(rootPath, "snapshots", "only.backup"),
    "backup fixture",
  );
  await fs.writeFile(path.join(rootPath, ".env"), "SYNTHETIC_ONLY=true");

  assert.equal((await scan(engine, root)).status, "complete");
  const project = fileByName(engine, path.join("project", "main.ts"));
  const backup = fileByName(engine, path.join("snapshots", "only.backup"));
  assert.match(project.protectedReason ?? "", /Repository content/);
  assert.match(backup.protectedReason ?? "", /Backup/);
  assert.equal(
    engine.state().files.some((file) => file.relativePath === ".env"),
    false,
  );
  await assert.rejects(
    () => engine.makePlan("quarantine", [project.id]),
    /Repository content/,
  );
  await assert.rejects(
    () => engine.makePlan("organize", [backup.id]),
    /Backup/,
  );
});

test("apply refuses a file changed after plan creation", async (t) => {
  const { engine, root, rootPath } = await fixture(t);
  const source = path.join(rootPath, "mutable.txt");
  await fs.writeFile(source, "before");
  await scan(engine, root);
  const record = fileByName(engine, "mutable.txt");
  const plan = await engine.makePlan("quarantine", [record.id]);
  await fs.writeFile(source, "after and different");

  const job = await applyAndWait(engine, plan);
  assert.equal(job.status, "failed");
  assert.match(job.error ?? "", /Stale plan/);
  assert.equal(engine.get<Plan>("plan", plan.id).status, "needs-review");
  assert.equal(await fs.readFile(source, "utf8"), "after and different");
  assert.equal(engine.state().operations.length, 0);
});

test("quarantine is recoverable through an explicitly approved restore", async (t) => {
  const { engine, root, rootPath } = await fixture(t);
  const source = path.join(rootPath, "recover-me.txt");
  await fs.writeFile(source, "recoverable contents");
  await scan(engine, root);
  const plan = await engine.makePlan("quarantine", [
    fileByName(engine, "recover-me.txt").id,
  ]);

  assert.equal((await applyAndWait(engine, plan)).status, "complete");
  await assert.rejects(() => fs.access(source));
  const operation = engine.state().operations[0] as Operation;
  assert.equal(operation.status, "complete");
  assert.equal(
    await fs.readFile(path.join(rootPath, operation.destination), "utf8"),
    "recoverable contents",
  );

  const restore = await engine.restore(
    operation.id,
    engine.approve("restore", operation.id, operation.id),
  );
  await waitForIdle(engine);
  assert.equal(engine.get<Job>("job", restore.id).status, "complete");
  assert.equal(await fs.readFile(source, "utf8"), "recoverable contents");
  assert.equal(
    engine.get<Operation>("operation", operation.id).status,
    "restored",
  );
});

test("restore collision never overwrites the replacement source", async (t) => {
  const { engine, root, rootPath } = await fixture(t);
  const source = path.join(rootPath, "collision.txt");
  await fs.writeFile(source, "quarantined version");
  await scan(engine, root);
  const plan = await engine.makePlan("quarantine", [
    fileByName(engine, "collision.txt").id,
  ]);
  await applyAndWait(engine, plan);
  const operation = engine.state().operations[0] as Operation;
  await fs.writeFile(source, "new replacement");

  const restore = await engine.restore(
    operation.id,
    engine.approve("restore", operation.id, operation.id),
  );
  await waitForIdle(engine);
  assert.equal(engine.get<Job>("job", restore.id).status, "failed");
  assert.equal(await fs.readFile(source, "utf8"), "new replacement");
  assert.equal(
    await fs.readFile(path.join(rootPath, operation.destination), "utf8"),
    "quarantined version",
  );
  assert.equal(
    engine.get<Operation>("operation", operation.id).status,
    "needs-recovery",
  );
});

test("organize copies into the category tree and retains the original", async (t) => {
  const { engine, root, rootPath } = await fixture(t);
  const source = path.join(rootPath, "notes.txt");
  await fs.writeFile(source, "original stays here");
  await scan(engine, root);
  const plan = await engine.makePlan("organize", [
    fileByName(engine, "notes.txt").id,
  ]);

  assert.equal((await applyAndWait(engine, plan)).status, "complete");
  const operation = engine.state().operations[0] as Operation;
  assert.equal(await fs.readFile(source, "utf8"), "original stays here");
  assert.equal(
    await fs.readFile(path.join(rootPath, operation.destination), "utf8"),
    "original stays here",
  );
  assert.equal(operation.kind, "organize");
});

test("restart reconciliation resolves a prepared journal without mutating files", async (t) => {
  const { dataPath, engine, root, rootPath } = await fixture(t);
  const source = path.join(rootPath, "journal.txt");
  await fs.writeFile(source, "journal fixture");
  await scan(engine, root);
  const plan = await engine.makePlan("quarantine", [
    fileByName(engine, "journal.txt").id,
  ]);
  const item = plan.items[0];
  const operation: Operation = {
    id: "prepared-operation",
    planId: plan.id,
    rootId: root.id,
    kind: "quarantine",
    source: item.source,
    destination: item.destination,
    status: "prepared",
    identity: item.identity,
  };
  engine.put("operation", operation);
  await engine.close();

  const restarted = new Engine(dataPath);
  t.after(() => restarted.close());
  await restarted.reconcile();
  assert.equal(
    restarted.get<Operation>("operation", operation.id).status,
    "not-applied",
  );
  assert.equal(await fs.readFile(source, "utf8"), "journal fixture");
  await assert.rejects(() =>
    fs.access(path.join(rootPath, operation.destination)),
  );
});
