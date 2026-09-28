import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { receipt, ReceiptStore } from "./receipts.ts";

// Explicit file import only; no automatic scan and no command execution.
try {
  const file = process.argv[2];
  if (!file) throw Error("Usage: npm run receipt:import -- receipt.json (JEV tokens only)");
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384) throw Error("Receipt must be a regular JSON file under 16 KiB");
  const value = receipt(JSON.parse(await fs.readFile(file, "utf8")));
  if (value.source !== "project-import") throw Error("External imports must use source project-import");
  const store = new ReceiptStore(process.env.JEV_MAC_DATA_DIR || fileURLToPath(new URL("../runtime", import.meta.url)));
  try { console.log(store.add(value) ? "Receipt saved locally." : "Receipt already recorded; not counted twice."); }
  finally { store.close(); }
} catch { console.error("Import failed. Check the receipt schema, ID uniqueness, file size and local storage. No file contents are logged."); process.exitCode = 1; }
