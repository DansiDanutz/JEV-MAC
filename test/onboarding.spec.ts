import { test, expect } from "@playwright/test";
import { promises as fs } from "node:fs";
import { startServer } from "../src/server.ts";

test("point-and-click folder options require confirmation and keep scanning separate", async ({
  page,
}) => {
  const dataDir = await fs.mkdtemp("/private/tmp/jev-onboarding-data-");
  const folder = await fs.mkdtemp("/private/tmp/jev-onboarding-files-");
  let picks = 0;
  const app = await startServer({
    dataDir,
    port: 0,
    folderPicker: async () => (++picks === 1 ? null : folder),
  });
  try {
    await page.goto(`${app.origin}/#token=${app.browserToken}`);
    await expect(
      page.getByRole("button", { name: /Downloads Review/ }),
    ).toBeVisible();
    await page.getByRole("button", { name: /Downloads Review/ }).click();
    await expect(
      page.getByText(
        "Folder selection cancelled. Nothing was connected or scanned.",
      ),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /Choose another folder Browse/ })
      .click();
    const dialog = page.getByRole("dialog", { name: "Connect this folder?" });
    await expect(dialog).toContainText(folder);
    expect(app.engine.list("root")).toHaveLength(0);
    await dialog
      .getByRole("button", { name: "Connect folder", exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: "Scan", exact: true }),
    ).toBeVisible();
    expect(app.engine.list("job")).toHaveLength(0);
    await page.getByRole("button", { name: "Refresh status" }).click();
    expect(app.engine.list("job")).toHaveLength(0);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByPlaceholder("/Users/you/Documents/Test Folder"),
    ).toBeHidden();
  } finally {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
    await fs.rm(folder, { recursive: true, force: true });
  }
});
