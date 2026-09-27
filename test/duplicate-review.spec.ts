import { test, expect } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";
import { startServer } from "../src/server.ts";
import type { Operation, Job } from "../src/core.ts";

test("duplicate cards keep one copy, ignore/restore groups, preview and restore safely", async ({
  page,
}) => {
  const dataDir = await fs.mkdtemp("/private/tmp/jev-duplicate-ui-");
  const app = await startServer({ dataDir, port: 0 });
  const root = await app.engine.demo();
  try {
    await app.engine.scan(root.id);
    await expect.poll(() => app.engine.active.size).toBe(0);
    await page.goto(`${app.origin}/#token=${app.browserToken}`);
    await page
      .getByRole("button", { name: "Review / Plans", exact: true })
      .click();
    const group = page.getByRole("article", { name: /Duplicate group:/ });
    await expect(group).toHaveCount(1);
    await expect(
      group.getByRole("button", { name: "Preview quarantine", exact: true }),
    ).toBeDisabled();
    await group
      .getByRole("button", { name: "Ignore group", exact: true })
      .click();
    await expect(group).toHaveCount(0);
    await page.reload();
    await page
      .getByRole("button", { name: "Review / Plans", exact: true })
      .click();
    await expect(group).toHaveCount(0);
    await page.getByRole("checkbox", { name: /Show ignored groups/ }).check();
    await group.getByRole("button", { name: "Bring group back" }).click();
    await expect(
      group.getByRole("button", { name: "Ignore group", exact: true }),
    ).toBeVisible();
    await group
      .getByRole("button", { name: "Keep this copy", exact: true })
      .first()
      .click();
    await group.getByRole("button", { name: "Select other copies" }).click();
    await expect(group.getByRole("checkbox", { checked: true })).toHaveCount(1);
    await group
      .getByRole("button", { name: "Preview quarantine (1)", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Approve exact quarantine plan?",
    });
    await expect(dialog).toContainText("This copy stays in place");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect(app.engine.list("operation")).toHaveLength(0);
    await group
      .getByRole("button", { name: "Preview quarantine (1)", exact: true })
      .click();
    await dialog.getByRole("button", { name: /Approve plan / }).click();
    await expect
      .poll(
        () =>
          app.engine.list<Job>("job").find((j) => j.type === "apply")?.status,
      )
      .toBe("complete");
    const op = app.engine.list<Operation>("operation")[0];
    await expect
      .poll(() =>
        fs.stat(path.join(root.path, op.source)).then(
          () => true,
          () => false,
        ),
      )
      .toBe(false);
    await page.getByRole("button", { name: "History", exact: true }).click();
    await page.getByRole("button", { name: "Restore this operation" }).click();
    await expect
      .poll(
        () =>
          app.engine.list<Job>("job").find((j) => j.type === "restore")?.status,
      )
      .toBe("complete");
    expect(
      await fs.readFile(path.join(root.path, op.source), "utf8"),
    ).toContain("Synthetic material");
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rm(root.path, { recursive: true, force: true });
  }
});
