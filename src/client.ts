import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const commands = {
  status: {
    route: "/api/state",
    method: "GET",
    description:
      "Read current catalog, jobs, diagnostics, plans and recovery history.",
  },
  scan: {
    route: "/api/scan",
    method: "POST",
    description: "Scan an already approved root; rootId required.",
  },
  cancel: {
    route: "/api/cancel",
    method: "POST",
    description: "Stop an active job safely; jobId required.",
  },
  plan: {
    route: "/api/plan",
    method: "POST",
    description:
      "Preview organize or quarantine for fileIds. Does not mutate files.",
  },
  classify_preview: {
    route: "/api/classify-preview",
    method: "POST",
    description:
      "Preview metadata that would be sent to Jev for fileIds. Does not send it.",
  },
} as const;
export type Command = keyof typeof commands;
export async function request(
  command: Command,
  args: Record<string, unknown> = {},
  dataDir = process.env.JEV_MAC_DATA_DIR ||
    fileURLToPath(new URL("../runtime", import.meta.url)),
) {
  const settings = JSON.parse(
    await fs.readFile(path.join(dataDir, "agent.json"), "utf8"),
  );
  const origin = new URL(settings.origin);
  if (
    origin.protocol !== "http:" ||
    origin.hostname !== "127.0.0.1" ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/"
  )
    throw Error("Invalid local service address");
  const spec = commands[command];
  if (!spec) throw Error("Unsupported command");
  const url = new URL(spec.route, origin);
  if (command === "status")
    for (const key of ["search", "offset", "limit"])
      if (args[key] !== undefined) url.searchParams.set(key, String(args[key]));
  const response = await fetch(url, {
    method: spec.method,
    headers: {
      Authorization: `Bearer ${settings.agentToken}`,
      "Content-Type": "application/json",
    },
    body: spec.method === "POST" ? JSON.stringify(args) : undefined,
    signal: AbortSignal.timeout(30000),
    redirect: "error",
  });
  const result = (await response.json()) as { error?: string };
  if (!response.ok) throw Error(result.error || "Local service request failed");
  return result;
}
