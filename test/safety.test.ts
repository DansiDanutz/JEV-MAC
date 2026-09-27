import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { test, type TestContext } from "node:test";
import {
  Engine,
  type FileRecord,
  type Job,
  type Operation,
  type Plan,
  type Root,
} from "../src/core.ts";

const run = promisify(execFile);

async function fixture(t: TestContext) {
  const base = await fs.mkdtemp("/private/tmp/jev-mac-safety-");
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

async function waitForIdle(engine: Engine, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (engine.active.size > 0) {
    if (Date.now() > deadline)
      throw new Error("Engine job did not finish in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function scan(engine: Engine, root: Root) {
  const job = await engine.scan(root.id);
  await waitForIdle(engine);
  assert.equal(engine.get<Job>("job", job.id).status, "complete");
}

function file(engine: Engine, relativePath: string): FileRecord {
  const result = engine
    .state()
    .files.find((candidate) => candidate.relativePath === relativePath);
  assert.ok(result, `Expected scanned file ${relativePath}`);
  return result;
}

async function apply(engine: Engine, plan: Plan) {
  const token = engine.approve("apply", plan.id, plan.id);
  const job = await engine.apply(plan.id, token);
  await waitForIdle(engine);
  return engine.get<Job>("job", job.id);
}

test("approval grants are opaque, action/id bound, and single use", async (t) => {
  const { engine, root, rootPath } = await fixture(t);
  await fs.writeFile(path.join(rootPath, "one.txt"), "one");
  await fs.writeFile(path.join(rootPath, "two.txt"), "two");
  await scan(engine, root);
  const first = await engine.makePlan("organize", [file(engine, "one.txt").id]);
  const second = await engine.makePlan("organize", [
    file(engine, "two.txt").id,
  ]);

  await assert.rejects(
    () => engine.apply(first.id, first.id),
    /Fresh single-use approval required/,
  );

  const wrongBound = engine.approve("apply", first.id, first.id);
  await assert.rejects(
    () => engine.apply(second.id, wrongBound),
    /Fresh single-use approval required/,
  );
  await assert.rejects(
    () => engine.apply(first.id, wrongBound),
    /Fresh single-use approval required/,
  );

  const token = engine.approve("apply", first.id, first.id);
  const started = await engine.apply(first.id, token);
  await assert.rejects(
    () => engine.apply(first.id, token),
    /Fresh single-use approval required/,
  );
  await waitForIdle(engine);
  assert.equal(engine.get<Job>("job", started.id).status, "complete");
});

test("native inspect refuses a replacement at the registered root path", async (t) => {
  const { base, engine, root, rootPath } = await fixture(t);
  await fs.writeFile(path.join(rootPath, "before.txt"), "registered root");
  const displaced = path.join(base, "displaced-root");
  await fs.rename(rootPath, displaced);
  await fs.mkdir(rootPath);
  await fs.writeFile(path.join(rootPath, "before.txt"), "replacement root");

  await assert.rejects(
    () => engine.inspect(root, "before.txt"),
    /Root identity changed|Root mismatch|Directory unavailable/,
  );
});

test("a failed initial job journal never registers active work and fences new work", async (t) => {
  const { engine } = await fixture(t);
  const originalPut = engine.put.bind(engine);
  engine.put = (() => {
    throw new Error("synthetic disk full");
  }) as typeof engine.put;

  assert.throws(
    () => engine.start("injected", async () => undefined),
    /synthetic disk full/,
  );
  assert.equal(engine.active.size, 0);

  engine.put = originalPut;
  assert.throws(
    () => engine.start("must-be-fenced", async () => undefined),
    /degraded|journal|storage/i,
  );
  assert.equal(engine.active.size, 0);
});

test("failed completion journals always clear active and mutation, then fence new work", async (t) => {
  const { engine, root, rootPath } = await fixture(t);
  await fs.writeFile(path.join(rootPath, "disk-full.txt"), "synthetic data");
  await scan(engine, root);
  const plan = await engine.makePlan("organize", [
    file(engine, "disk-full.txt").id,
  ]);
  const originalPut = engine.put.bind(engine);
  let finalPhase = false;
  engine.put = ((kind: string, value: { id: string; status?: string }) => {
    if ((kind === "plan" && value.status === "complete") || finalPhase) {
      finalPhase = true;
      throw new Error("synthetic final journal failure");
    }
    return originalPut(kind, value);
  }) as typeof engine.put;

  const token = engine.approve("apply", plan.id, plan.id);
  const started = await engine.apply(plan.id, token);
  await waitForIdle(engine);
  assert.equal(engine.active.size, 0);
  assert.equal(engine.mutation, false);

  engine.put = originalPut;
  assert.throws(
    () => engine.start("must-be-fenced", async () => undefined),
    /degraded|journal|storage/i,
  );
  assert.equal(engine.active.size, 0);
  assert.equal(started.type, "apply");
});

test("restore-phase recovery with only the source present resolves as restored", async (t) => {
  const { engine, root, rootPath } = await fixture(t);
  await fs.writeFile(path.join(rootPath, "restored.txt"), "already moved back");
  await scan(engine, root);
  const record = file(engine, "restored.txt");
  const operation: Operation = {
    id: "restore-phase-operation",
    planId: "synthetic-plan",
    rootId: root.id,
    kind: "quarantine",
    source: record.relativePath,
    destination: path.join(
      ".jev-mac-quarantine",
      "synthetic-plan",
      "document",
      record.relativePath,
    ),
    status: "needs-recovery",
    phase: "restore",
    identity: record,
  };
  engine.put("operation", operation);

  await engine.reconcile();
  const reconciled = engine.get<Operation>("operation", operation.id);
  assert.equal(reconciled.status, "restored");
  assert.equal(reconciled.error, undefined);
  assert.equal(
    await fs.readFile(path.join(rootPath, "restored.txt"), "utf8"),
    "already moved back",
  );
});

async function metadata(filePath: string, attribute: string) {
  const stat = await fs.stat(filePath);
  const { stdout } = await run("/usr/bin/xattr", ["-p", attribute, filePath]);
  return { mode: stat.mode & 0o777, mtimeMs: stat.mtimeMs, xattr: stdout };
}

test("quarantine restore and organize copy preserve mode, timestamps, and xattrs", async (t) => {
  const { engine, root, rootPath } = await fixture(t);
  const attribute = "com.jev-mac.synthetic-test";
  const timestamp = new Date("2024-02-03T04:05:06.000Z");
  const quarantinePath = path.join(rootPath, "metadata.txt");
  const organizePath = path.join(rootPath, "copy.txt");
  for (const target of [quarantinePath, organizePath]) {
    await fs.writeFile(target, "fixed synthetic metadata");
    await fs.chmod(target, 0o640);
    await fs.utimes(target, timestamp, timestamp);
    await run("/usr/bin/xattr", ["-w", attribute, "fixed-value", target]);
  }
  const expectedQuarantine = await metadata(quarantinePath, attribute);
  const expectedCopy = await metadata(organizePath, attribute);
  await scan(engine, root);

  const quarantinePlan = await engine.makePlan("quarantine", [
    file(engine, "metadata.txt").id,
  ]);
  assert.equal((await apply(engine, quarantinePlan)).status, "complete");
  const operation = engine
    .state()
    .operations.find(
      (candidate: Operation) => candidate.planId === quarantinePlan.id,
    ) as Operation;
  const restoreToken = engine.approve("restore", operation.id, operation.id);
  const restoreJob = await engine.restore(operation.id, restoreToken);
  await waitForIdle(engine);
  assert.equal(engine.get<Job>("job", restoreJob.id).status, "complete");
  assert.deepEqual(
    await metadata(quarantinePath, attribute),
    expectedQuarantine,
  );

  const organizePlan = await engine.makePlan("organize", [
    file(engine, "copy.txt").id,
  ]);
  assert.equal((await apply(engine, organizePlan)).status, "complete");
  const copyOperation = engine
    .state()
    .operations.find(
      (candidate: Operation) => candidate.planId === organizePlan.id,
    ) as Operation;
  assert.deepEqual(
    await metadata(path.join(rootPath, copyOperation.destination), attribute),
    expectedCopy,
  );
  assert.deepEqual(await metadata(organizePath, attribute), expectedCopy);
});

test("ordinary .hg and .svn marker files protect repository contents", async (t) => {
  const { engine, root, rootPath } = await fixture(t);
  for (const [folder, marker] of [
    ["mercurial", ".hg"],
    ["subversion", ".svn"],
  ] as const) {
    const project = path.join(rootPath, folder);
    await fs.mkdir(project);
    await fs.writeFile(
      path.join(project, marker),
      "synthetic repository marker",
    );
    await fs.writeFile(path.join(project, "work.txt"), `${folder} contents`);
  }

  await scan(engine, root);
  for (const relative of [
    path.join("mercurial", "work.txt"),
    path.join("subversion", "work.txt"),
  ]) {
    const record = file(engine, relative);
    assert.match(record.protectedReason ?? "", /Repository content/);
    await assert.rejects(
      () => engine.makePlan("organize", [record.id]),
      /Repository content/,
    );
  }
});

test("cancelled rescan retains the last successful catalog and reports an incomplete root", async (t) => {
  const { engine, root, rootPath } = await fixture(t);
  await fs.writeFile(
    path.join(rootPath, "known.txt"),
    "last successful catalog",
  );
  await scan(engine, root);
  const known = file(engine, "known.txt");
  await fs.writeFile(
    path.join(rootPath, "not-committed.txt"),
    "only present during cancelled scan",
  );

  const rescan = await engine.scan(root.id);
  engine.cancel(rescan.id);
  await waitForIdle(engine);
  assert.equal(engine.get<Job>("job", rescan.id).status, "cancelled");
  assert.equal(file(engine, "known.txt").id, known.id);
  assert.equal(
    engine
      .state()
      .files.some((record) => record.relativePath === "not-committed.txt"),
    false,
  );
  assert.deepEqual(engine.state().summary.incompleteRoots, [rootPath]);
});

test("approval digest rejects a plan changed after approval", async (t) => {
  const { engine, root, rootPath } = await fixture(t);
  await fs.writeFile(
    path.join(rootPath, "approved.txt"),
    "approval-bound contents",
  );
  await scan(engine, root);
  const plan = await engine.makePlan("organize", [
    file(engine, "approved.txt").id,
  ]);
  const token = engine.approve("apply", plan.id, plan.id);
  engine.put("plan", {
    ...plan,
    createdAt: new Date(Date.parse(plan.createdAt) + 1).toISOString(),
  });

  await assert.rejects(
    () => engine.apply(plan.id, token),
    /Approved plan changed/,
  );
  assert.equal(
    await fs.readFile(path.join(rootPath, "approved.txt"), "utf8"),
    "approval-bound contents",
  );
  assert.equal(engine.active.size, 0);
});

test("synthetic Time Machine roots are denied at registration", async (t) => {
  const { base, engine } = await fixture(t);
  const timeMachine = path.join(base, ".timemachine", "snapshot");
  await fs.mkdir(timeMachine, { recursive: true });
  await assert.rejects(() => engine.addRoot(timeMachine), /Protected location/);
});

test("a DELETE journal failure sets the degraded fence", async (t) => {
  const { engine } = await fixture(t);
  const originalPrepare = engine.db.prepare.bind(engine.db);
  engine.db.prepare = ((sql: string) => {
    if (sql.startsWith("DELETE"))
      throw new Error("synthetic DELETE disk failure");
    return originalPrepare(sql);
  }) as typeof engine.db.prepare;

  assert.throws(
    () => engine.remove("file", "synthetic-id"),
    /synthetic DELETE disk failure/,
  );
  engine.db.prepare = originalPrepare;
  assert.equal(engine.degraded, true);
  assert.throws(
    () => engine.start("must-be-fenced", async () => undefined),
    /degraded|journal|storage/i,
  );
});

test("planning rejects an inspected file on a mismatched device", async (t) => {
  const { engine, root, rootPath } = await fixture(t);
  await fs.writeFile(
    path.join(rootPath, "different-device.txt"),
    "device policy fixture",
  );
  await scan(engine, root);
  const record = file(engine, "different-device.txt");
  const originalInspect = engine.inspect.bind(engine);
  engine.inspect = (async (...args: Parameters<Engine["inspect"]>) => ({
    ...(await originalInspect(...args)),
    dev: `${root.dev}-mismatch`,
  })) as typeof engine.inspect;

  try {
    await assert.rejects(
      () => engine.makePlan("organize", [record.id]),
      /Cross-volume changes are not enabled/,
    );
  } finally {
    engine.inspect = originalInspect;
  }
  assert.equal(engine.state().plans.length, 0);
});

test("copy destination collision preserves original, existing destination, and recovery part", async (t) => {
  const { engine, root, rootPath } = await fixture(t);
  const sourceContents = "source must survive collision";
  const existingContents = "existing destination must not change";
  const source = path.join(rootPath, "collision-copy.txt");
  await fs.writeFile(source, sourceContents);
  await scan(engine, root);
  const plan = await engine.makePlan("organize", [
    file(engine, "collision-copy.txt").id,
  ]);
  const destination = path.join(rootPath, plan.items[0].destination);
  const recoveryPart = `${destination}.jev-part`;
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, existingContents);

  const job = await apply(engine, plan);
  assert.equal(job.status, "failed");
  assert.equal(await fs.readFile(source, "utf8"), sourceContents);
  assert.equal(await fs.readFile(destination, "utf8"), existingContents);
  assert.equal(await fs.readFile(recoveryPart, "utf8"), sourceContents);
  const operation = engine
    .state()
    .operations.find(
      (candidate: Operation) => candidate.planId === plan.id,
    ) as Operation;
  assert.equal(operation.status, "needs-recovery");
  assert.match(operation.error ?? "", /preserved|recovery|interrupted/i);
});
