import { chromium } from "@playwright/test";
import { promises as fs } from "node:fs";
import { startServer } from "../src/server.ts";

const dataDir = await fs.mkdtemp("/private/tmp/jev-ui-proof-");
const app = await startServer({ dataDir, port: 0 });
const root = await app.engine.demo();
await app.engine.scan(root.id);
while (app.engine.active.size)
  await new Promise((resolve) => setTimeout(resolve, 20));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto(`${app.origin}/#token=${app.browserToken}`);
  await page.getByRole("heading", { name: "Overview", exact: true }).waitFor();
  await page.getByText("4", { exact: true }).waitFor();
  await fs.mkdir("runtime", { recursive: true, mode: 0o700 });
  await page.screenshot({
    path: "runtime/dashboard-proof.png",
    fullPage: true,
  });
  console.log("Saved synthetic dashboard proof to runtime/dashboard-proof.png");
} finally {
  await browser.close();
  await app.close();
  await fs.rm(dataDir, { recursive: true, force: true });
  await fs.rm(root.path, { recursive: true, force: true });
}
