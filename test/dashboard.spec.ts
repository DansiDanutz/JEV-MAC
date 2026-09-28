import { test, expect, type Page } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { build } from "vite";
import { startServer } from "../src/server.ts";

type App = Awaited<ReturnType<typeof startServer>>;
let app: App;
let dataDir = "";
let demoRoot = "";

async function openDashboard(page: Page) {
  await page.goto(`${app.origin}/#token=${app.browserToken}`);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page).toHaveURL(`${app.origin}/`);
}

async function waitForLatestJob(
  appInstance: App,
  type: string,
  status: string,
) {
  await expect
    .poll(
      () =>
        appInstance.engine
          .list<{ type: string; status: string }>("job")
          .find((job) => job.type === type)?.status,
    )
    .toBe(status);
}

test.describe.configure({ mode: "serial" });

test("Local Storage is read-only on open and offers connected-folder review", async ({ page }) => {
  await openDashboard(page);
  await page.getByRole("button", { name: "Local Storage", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Make room for your next project" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Disk headroom" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview JEV review (0)" })).toBeDisabled();
  expect(app.engine.list("job")).toHaveLength(0);
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.getByRole("button", { name: "Connect folders / scan" }).click();
  await expect(page.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
});

test("analytics distinguishes recorded tokens from unmeasured savings", async ({ page }) => {
  await page.route("**/api/jev-analytics", route => route.fulfill({ json: {
    collectedAt: "2026-09-28T00:00:00Z", totalInput: 12, totalOutput: 3,
    meteredRecords: 1, unmeteredRecords: 20, sources: [], features: [], installations: [],
    coverage: "Partial local evidence only.", baselineTokens: null, measuredSavings: null,
    daily: { "2026-09-28": { input: 12, output: 3, records: 1 } },
    harnesses: [{ name: "Codex", records: 1, metered: 1, input: 12, output: 3, models: { "test-model": 1 }, note: "Current history only" }, { name: "Kimi", records: 0, metered: 0, input: 0, output: 0, models: {}, note: "No attributable usage" }],
  } }));
  await openDashboard(page);
  await page.getByRole("button", { name: "JEV Analytics", exact: true }).click();
  await expect(page.getByRole("heading", { name: "15 JEV tokens", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Without JEV / tokens saved: not measured" })).toBeVisible();
  await expect(page.getByText("20 records have no token counts.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh status", exact: true })).toHaveCount(0);
  await page.getByLabel("Show harness").selectOption("Kimi");
  await expect(page.getByRole("heading", { name: "Codex", exact: true })).toHaveCount(0);
  await expect(page.getByText("No attributable records available", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Daily recorded JEV usage (UTC)" })).toBeVisible();
  await page.getByRole("button", { name: "Refresh JEV analytics", exact: true }).click();
  await expect(page.getByRole("heading", { name: "15 JEV tokens", exact: true })).toBeVisible();
});

test.beforeAll(async () => {
  dataDir = await fs.mkdtemp("/private/tmp/jev-dashboard-data-");
  await build({
    root: "web",
    build: { outDir: "../dist", emptyOutDir: true },
    logLevel: "silent",
  });
  app = await startServer({ dataDir, port: 0 });
});

test("router health shows evidence without claiming live reliability and handles errors", async ({ page }) => {
  let fail = false;
  await page.route("**/api/router-health", route => fail ? route.fulfill({ status: 500, json: { error: "fixture" } }) : route.fulfill({ json: {
    checkedAt: "2026-09-28T00:00:00Z", version: "0.3.0", recordedDecisions: 1,
    privacy: { restricted: true, directoryMode: "700", checkedFiles: 1, insecureFiles: 0, skippedFiles: 0, complete: true },
    recent: [{ at: "2026-09-28T00:00:00Z", harness: "codex", model: "test-model", tokens: 1785 }],
  } }));
  await openDashboard(page);
  await page.getByRole("button", { name: "Router Health", exact: true }).click();
  await expect(page.getByRole("heading", { name: "JEV Router checks" })).toBeVisible();
  await expect(page.getByText("Checked log permissions are restricted", { exact: true })).toBeVisible();
  await expect(page.getByText("codex → test-model", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh status", exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(page.getByRole("button", { name: "Refresh router checks" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  fail = true;
  await page.getByRole("button", { name: "Refresh router checks" }).click();
  await expect(page.getByRole("alert")).toContainText("Could not check the router");
});

test("connects an isolated browser with a one-time code and recovers an expired session", async ({ page, browser }) => {
  await openDashboard(page);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Create connection code", exact: true }).click();
  const notice = page.getByRole("status").filter({ hasText: "Connection code:" });
  await expect(notice).toBeVisible();
  const code = await notice.locator("code").innerText();
  const isolated = await browser.newContext();
  try {
    const other = await isolated.newPage();
    await other.goto(`${app.origin}/#token=expired-test-session`);
    await expect(other.getByRole("heading", { name: "Connect to JEV-MAC", exact: true })).toBeVisible();
    await other.getByLabel("Connection code", { exact: true }).fill(code);
    await other.getByRole("button", { name: "Connect this browser", exact: true }).click();
    await expect(other.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
    await other.reload();
    await expect(other.getByRole("heading", { name: "Overview", exact: true })).toBeVisible();
  } finally { await isolated.close(); }
});

test.afterAll(async () => {
  if (app) await app.close();
  if (dataDir) await fs.rm(dataDir, { recursive: true, force: true });
  if (demoRoot) await fs.rm(demoRoot, { recursive: true, force: true });
});

test("starts empty and creates a synthetic demo without scanning", async ({
  page,
}) => {
  await openDashboard(page);
  await expect(page.getByText("No folder approved")).toBeVisible();
  await expect(
    page
      .getByRole("article")
      .filter({ hasText: "Cataloged files" })
      .getByText("0", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Create safe demo" }).click();
  await expect(page.getByRole("button", { name: "Scan" })).toBeVisible();
  demoRoot = app.engine.list<{ path: string }>("root")[0].path;
  expect(demoRoot).toMatch(/^\/private\/tmp\/jev-mac-demo-/);
  await expect.poll(() => app.engine.list("file").length).toBe(0);
});

test("scans the demo and exposes the catalog without fabricated counts", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByRole("button", { name: "Scan" }).click();
  await waitForLatestJob(app, "scan", "complete");
  await expect(page.getByText("4", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(page.getByText("4 matching files")).toBeVisible();
  await expect(
    page.getByText("Downloads/notes.txt", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Downloads/brief-copy.md", { exact: true }),
  ).toBeVisible();
});

test("previews, cancels, and explicitly approves an organize plan", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Select Downloads/notes.txt" })
    .check();
  await page.getByRole("button", { name: "Plan copy organization" }).click();

  const dialog = page.getByRole("dialog", {
    name: "Create these organized copies?",
  });
  await expect(dialog).toContainText("_JEV_Organized");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Review / Plans" }).click();
  await page.getByRole("button", { name: "Review", exact: true }).click();
  const approval = page.getByRole("dialog", {
    name: "Create these organized copies?",
  });
  await approval.getByRole("button", { name: "Create copies", exact: true }).click();
  await waitForLatestJob(app, "apply", "complete");
  await expect
    .poll(async () =>
      fs.readFile(path.join(demoRoot, "Downloads", "notes.txt"), "utf8"),
    )
    .toBe("Keep original notes.\n");
  const organized = app.engine
    .list<{ kind: string; destination: string }>("operation")
    .find((op) => op.kind === "organize");
  expect(organized).toBeTruthy();
  await expect
    .poll(() =>
      fs.readFile(path.join(demoRoot, organized!.destination), "utf8"),
    )
    .toBe("Keep original notes.\n");
});

test("quarantines a selected file and restores it from History", async ({
  page,
}) => {
  await openDashboard(page);
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "Select Downloads/Screenshot demo.txt" })
    .check();
  await page.getByRole("button", { name: "Review / Plans" }).click();
  await page.getByRole("button", { name: "Plan quarantine for 1" }).click();

  const dialog = page.getByRole("dialog", {
    name: "Move these files to quarantine?",
  });
  await expect(dialog).toContainText("does not reclaim disk space");
  await dialog.getByRole("button", { name: "Move to quarantine", exact: true }).click();
  await waitForLatestJob(app, "apply", "complete");
  await expect
    .poll(() =>
      fs.stat(path.join(demoRoot, "Downloads", "Screenshot demo.txt")).then(
        () => true,
        () => false,
      ),
    )
    .toBe(false);

  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByText("quarantine", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Restore this operation" }).click();
  await waitForLatestJob(app, "restore", "complete");
  await expect
    .poll(() =>
      fs.readFile(
        path.join(demoRoot, "Downloads", "Screenshot demo.txt"),
        "utf8",
      ),
    )
    .toContain("Synthetic screenshot");
  await expect(page.getByText("restored", { exact: true })).toBeVisible();
});

test("keeps a stopping job active until its work settles", async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const job = app.engine.start("scan", async (signal) => {
    await held;
    signal.throwIfAborted();
  });

  await openDashboard(page);
  await expect(page.getByRole("button", { name: "Stop safely" })).toBeVisible();
  await page.getByRole("button", { name: "Stop safely" }).click();
  await expect
    .poll(() => app.engine.get<{ status: string }>("job", job.id).status)
    .toBe("stopping");

  const pending = page.getByRole("button", { name: "Stop pending" });
  await expect(pending).toBeVisible();
  await expect(pending).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Sync catalog", exact: true }),
  ).toBeDisabled();

  release();
  await expect
    .poll(() => app.engine.get<{ status: string }>("job", job.id).status)
    .toBe("cancelled");
  await expect(page.getByText("No active job")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sync catalog", exact: true }),
  ).toBeEnabled();
});

test("stops a scan, rescans, and reconnects to the persisted session", async ({
  page,
}) => {
  const bulk = path.join(demoRoot, "Bulk");
  await fs.mkdir(bulk);
  await Promise.all(
    Array.from({ length: 350 }, (_, index) =>
      fs.writeFile(
        path.join(bulk, `fixture-${index}.txt`),
        `fixture ${index}\n`,
      ),
    ),
  );

  await openDashboard(page);
  await page.getByRole("button", { name: /^(Scan|Sync catalog)$/ }).click();
  await expect(page.getByRole("button", { name: "Stop safely" })).toBeVisible();
  await page.getByRole("button", { name: "Stop safely" }).click();
  await waitForLatestJob(app, "scan", "cancelled");
  await expect(page.getByText("No active job")).toBeVisible();

  await page.getByRole("button", { name: /^(Scan|Sync catalog)$/ }).click();
  await waitForLatestJob(app, "scan", "complete");
  await expect.poll(() => app.engine.state().summary.files).toBe(354);

  await app.close();
  app = await startServer({ dataDir, port: 0 });
  await page.goto("about:blank");
  await page.goto(`${app.origin}/#token=${app.browserToken}`);
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page).toHaveURL(`${app.origin}/`);
  await expect(page.getByText("354", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});
