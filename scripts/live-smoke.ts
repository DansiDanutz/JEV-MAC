import { promises as fs } from "node:fs";
import { buildPayload, classify } from "../src/jev.ts";

if (process.env.JEV_MAC_LIVE_TEST !== "1")
  throw Error("Set JEV_MAC_LIVE_TEST=1 to authorize one synthetic request.");
let apiKey = process.env.TYPESAFE_API_KEY || process.env.JEV_API_KEY || "";
if (!apiKey && process.env.JEV_MAC_KEY_FILE) {
  const stat = await fs.lstat(process.env.JEV_MAC_KEY_FILE);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
    throw Error("Key file must be private (600).");
  apiKey =
    (await fs.readFile(process.env.JEV_MAC_KEY_FILE, "utf8"))
      .match(/^(?:JEV_API_KEY|TYPESAFE_API_KEY)\s*=\s*([^\r\n]+)$/m)?.[1]
      ?.trim()
      .replace(/^['"]|['"]$/g, "") || "";
}
const payload = buildPayload([
  {
    id: "synthetic-smoke",
    name: "Screenshot demo.png",
    extension: ".png",
    size: 2048,
    modifiedAt: "2026-09-27T00:00:00.000Z",
  },
]);
try {
  const result = await classify(payload, { apiKey });
  console.log(
    JSON.stringify({
      model: result.model,
      results: result.results,
      usage: result.usage,
    }),
  );
} catch (e) {
  console.error(
    e instanceof Error ? e.message : "Synthetic provider test failed",
  );
  process.exitCode = 1;
}
