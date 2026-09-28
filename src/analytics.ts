import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { receiptId, type ReceiptStore } from "./receipts.ts";

type Row = Record<string, any>;
export type UsageSource = {
  name: string; location: string; records: number; metered: number;
  input: number; output: number; models: Record<string, number>;
  earliest: string | null; latest: string | null; warnings: string[];
  daily: Record<string, { input: number; output: number; records: number }>;
};
const number = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
export function summarize(name: string, location: string, rows: Row[]): UsageSource {
  const result: UsageSource = { name, location, records: rows.length, metered: 0, input: 0, output: 0, models: {}, earliest: null, latest: null, warnings: [], daily: {} };
  for (const row of rows) {
    const usage = row.jev?.response?.usage ?? row.output?.usage ?? row.usage;
    if (number(usage?.input_tokens) && number(usage?.output_tokens)) {
      result.metered++; result.input += usage.input_tokens; result.output += usage.output_tokens;
    }
    // Never return prompts, reasons, response bodies or arbitrary log fields.
    const model = row.model;
    if (typeof model === "string" && /^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,99}$/.test(model) && !/sk-|token|secret|key/i.test(model)) result.models[model] = (result.models[model] || 0) + 1;
    const raw = row.at ?? (typeof row.ts === "number" ? row.ts * 1000 : row.ts) ?? row.date;
    if (typeof raw === "string" || typeof raw === "number") {
      const d = new Date(raw);
      if (Number.isFinite(d.getTime())) {
        const t = d.toISOString();
        if (number(usage?.input_tokens) && number(usage?.output_tokens)) {
          const day = result.daily[t.slice(0, 10)] ??= { input: 0, output: 0, records: 0 };
          day.input += usage.input_tokens; day.output += usage.output_tokens; day.records++;
        }
        if (!result.earliest || t < result.earliest) result.earliest = t;
        if (!result.latest || t > result.latest) result.latest = t;
      }
    }
  }
  return result;
}

// Fixed, bounded sources only. No shell execution, config/credential reads or network.
async function read(file: string): Promise<string> {
  const s = await fs.lstat(file);
  if (!s.isFile() || s.isSymbolicLink() || s.size > 4 * 1024 * 1024) throw Error("unsafe-or-large");
  return fs.readFile(file, "utf8");
}
async function names(dir: string): Promise<string[]> {
  try { return (await fs.readdir(dir)).sort().slice(0, 100); } catch { return []; }
}
async function present(file: string) { try { await fs.access(file); return true; } catch { return false; } }

export const features = [
  { skill: "use-jev-codex", title: "Codex model routing", use: "Project coding and small tasks: let JEV select from the account model catalog.", command: "jev-codex  |  jev-codex resume --last", caveat: "Only routed CLI sessions. Installing it does not route this desktop chat automatically." },
  { skill: "jev-router-explain", title: "Explain a model choice", use: "Inspect the latest router decision before changing model policy.", command: "$jev-explain inside a routed session", caveat: "The router retains only recent session history, not a lifetime bill." },
  { skill: "jev-model-routing", title: "Hermes and cross-harness decisions", use: "Pick a suitable model for coding, research, writing or routine work.", command: "jev route --prompt '<task>' --current '<provider:model>'", caveat: "A CLI decision does not reconfigure Codex, Claude, Kimi or GLM by itself. Hermes automatic routing requires its plugin and routing mode." },
  { skill: "jev-memory", title: "Memory and search filtering", use: "Rank retrieved project notes and flag suspected prompt injection.", command: "jev rerank < candidates.json", caveat: "Selected snippets leave the Mac after redaction. No private customer data. Local-only fallback is not JEV verification." },
  { skill: "jev-skill-select", title: "Choose a skill", use: "Select relevant capabilities from large installed skill collections.", command: "jev pick-skill --turn '<task>'", caveat: "Suggests a skill; the host agent still loads it and enforces its permissions." },
  { skill: "jev-compaction", title: "Context selection", use: "Mark turns keep, summarize or drop when a strict context budget requires it.", command: "jev compact-select --digest < transcript.json", caveat: "Not a summary writer. Installed documentation reports worse handoff recall than full-dialogue summaries. Do not assume token reduction preserves quality." },
  { skill: "jev-browser-use", title: "Browser decisions", use: "Choose the next browser action from observed candidates.", command: "Ask your agent to use jev-browser-use for a specific browser task.", caveat: "Needs a working browser driver. JEV is the decision layer, not browser permissions or execution." },
  { skill: "jev-computer-use", title: "Mac computer decisions", use: "Choose a safe next action from the current screen and available actions.", command: "jev choose < request.json", caveat: "Requires an observation/action driver and macOS permissions. Not enabled by this analytics page." },
  { skill: "typesafe-computer-use", title: "TypeSafe computer-use adapter", use: "Agent-controlled Mac mouse and keyboard workflows.", command: "Ask your agent to load typesafe-computer-use.", caveat: "Installed skill requires explicit per-command approval for GUI operations. Runtime health is not checked here." },
  { skill: "jev-voice-browser", title: "Voice-to-browser workflow", use: "Use voice through the agent integration when explicitly requested.", command: "Ask your agent to load jev-voice-browser.", caveat: "Skill presence does not prove microphone, transcription or action execution works. The old voice dashboard was not reliable; it is not re-enabled here." },
  { skill: "jev-mailbox", title: "Email categorization", use: "Classify an approved mailbox export into attention and mail categories.", command: "jev mail --file inbox.json --summary", caveat: "Not a Gmail connection and never permission to delete or send mail. Content processing requires consent." },
  { skill: "jev-frontier-work", title: "Escalation and supervision", use: "Choose a frontier seat for genuinely hard work and inspect delegated run progress.", command: "jev ladder choose", caveat: "Paid model use needs a budget. Repeated supervision calls have overhead; deterministic status checks come first." },
  { skill: "typesafe-ai", title: "Project decision API", use: "Build constrained classifications and routing into your own projects.", command: "Ask your agent to use typesafe-ai with a bounded schema and usage receipts.", caveat: "JEV-MAC file classification is opt-in metadata-only with a 20-request daily ceiling and identical-payload caching. Hashing, scanning and quarantine use no JEV tokens." },
];

export async function collectAnalytics(options: { home?: string; temp?: string; cached?: Row[]; attempts?: number; store?: ReceiptStore } = {}) {
  const home = options.home ?? os.homedir();
  const temp = options.temp ?? os.tmpdir();
  const sources: UsageSource[] = [];
  const existingReceipts = new Map((options.store?.list() ?? []).map(r => [r.id, r]));
  const dir = path.join(temp, "jev-claude");
  const rows: Row[] = []; const routerWarnings: string[] = [];
  const codexRows: Row[] = []; const otherRouterRows: Row[] = []; const unsavedRows: Row[] = [];
  for (const file of (await names(dir)).filter(n => n.endsWith(".json"))) {
    try {
      const value = JSON.parse(await read(path.join(dir, file)));
      const history = Array.isArray(value.history) ? value.history : [value];
      const seen = new Set<string>();
      for (const r of history) {
        if (!r || typeof r !== "object") continue;
        const usage = r.jev?.response?.usage ?? r.output?.usage ?? r.usage;
        const raw = r.at ?? (typeof r.ts === "number" ? r.ts * 1000 : r.ts) ?? r.date;
        const date = typeof raw === "string" || typeof raw === "number" ? new Date(raw) : new Date(NaN);
        const id = JSON.stringify([raw, r.model, usage]);
        if (!seen.has(id)) {
          rows.push(r); seen.add(id);
          (/^codex-\d+\.json$/.test(file) ? codexRows : otherRouterRows).push(r);
          if (options.store && number(usage?.input_tokens) && number(usage?.output_tokens) && Number.isFinite(date.getTime())) {
            const model = typeof r.model === "string" && /^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,99}$/.test(r.model) && !/sk-|token|secret|key/i.test(r.model) ? r.model : undefined;
            const legacyId = receiptId("router", file + ":" + r.at);
            const legacy = existingReceipts.get(legacyId);
            const compatible = legacy && legacy.inputTokens === usage.input_tokens && legacy.outputTokens === usage.output_tokens && legacy.model === model;
            const eventId = compatible ? legacyId : receiptId("router", file + ":" + id);
            options.store.add({ id: eventId, source: "router", project: "unattributed", occurredAt: date.toISOString(), inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
              harness: /^codex-\d+\.json$/.test(file) ? "codex" : "unknown", ...(model ? { model } : {}), outcome: "decision-recorded" });
          } else unsavedRows.push(r);
        }
      }
    } catch { routerWarnings.push("One router file was unreadable, malformed or over the size limit."); }
  }
  const router = summarize("Codex / Claude router", "Temporary jev-claude session status", rows);
  const saved = options.store?.list() ?? [];
  const toRow = (r: typeof saved[number]) => ({ date: r.occurredAt, model: r.model, usage: { input_tokens: r.inputTokens, output_tokens: r.outputTokens } });
  if (options.store) {
    const persisted = summarize("Codex / Claude router", "Durable receipts imported from temporary session history", [...saved.filter(r => r.source === "router").map(toRow), ...unsavedRows]);
    // Unmetered current entries remain visible; stored metered entries replace, not add to, live ones.
    persisted.models = router.models;
    Object.assign(router, persisted);
  }
  router.warnings.push("At most 20 recent decisions per session; temporary files can disappear. Not installation-to-date usage.", ...routerWarnings);
  if (options.store) router.warnings.push("Captured metered receipts survive temporary-log removal. Polling can miss activity overwritten between captures. Source model counts describe current source history; attributed harness receipts retain captured models.");
  sources.push(router);
  const hermes = path.join(home, ".hermes");
  const profileDirs = [hermes, ...(await names(path.join(hermes, "profiles"))).map(n => path.join(hermes, "profiles", n))];
  for (const base of profileDirs) for (const name of ["jev-decisions.jsonl", "freellm-jev.jsonl"]) {
    const location = path.join(base, "logs", name);
    if (!await present(location)) continue;
    const records: Row[] = []; let invalid = 0;
    try { for (const line of (await read(location)).split("\n")) {
      if (!line.trim()) continue;
      try { const value = JSON.parse(line); if (value && typeof value === "object" && !Array.isArray(value)) records.push(value); else invalid++; } catch { invalid++; }
    } } catch { invalid++; }
    const source = summarize("Hermes decision log", path.relative(home, location), records);
    source.warnings.push("Decision records do not prove billable calls or executed model switches. Profiles and rotated logs may be incomplete.");
    if (invalid) source.warnings.push(`${invalid} malformed or unreadable records/files excluded.`);
    sources.push(source);
  }
  const savedIds = new Set(saved.map(r => r.id));
  const mac = summarize("JEV-MAC classification", "Durable receipts plus legacy unique cached responses", [
    ...(options.cached ?? []).filter(r => !r.receiptId || !savedIds.has(r.receiptId)),
    ...saved.filter(r => r.source === "jev-mac").map(toRow),
  ]);
  mac.warnings.push(`${options.attempts ?? 0} recorded request attempts; cached responses are not a full request ledger. Cache reuse is not counted as another API call.`);
  for (const project of [...new Set(saved.filter(r => r.source === "jev-mac").map(r => r.project))]) {
    const matching = saved.filter(r => r.source === "jev-mac" && r.project === project);
    mac.warnings.push(`Source-folder attribution ${project}: ${matching.reduce((n, r) => n + r.inputTokens + r.outputTokens, 0)} recorded JEV tokens. Folder ID is not a project-name inference.`);
  }
  sources.push(mac);
  for (const project of [...new Set(saved.filter(r => r.source === "project-import").map(r => r.project))]) {
    const source = summarize(`Project: ${project}`, "Explicit imported JEV usage receipts (self-reported)", saved.filter(r => r.source === "project-import" && r.project === project).map(toRow));
    source.warnings.push("Importer must exclude router and JEV-MAC calls already captured here. Not provider-verified billing.");
    sources.push(source);
  }
  const catalog = await Promise.all(features.map(async feature => ({ ...feature, installed: await present(path.join(home, ".agents", "skills", feature.skill, "SKILL.md")) || await present(path.join(home, ".codex", "skills", feature.skill, "SKILL.md")) })));
  const installations = await Promise.all([
    ["JEV CLI", ".local/bin/jev"],
    ["Codex router launcher", ".npm-global/bin/jev-codex"],
    ["Claude Code router launcher", ".npm-global/bin/jev-claude"],
    ["Hermes JEV plugin", ".hermes/plugins/hermes-jev"],
    ["Hermes FreeLLM JEV plugin", ".hermes/plugins/freellm-jev"],
    ["Voice browser checkout", "ZCodeProject/jev-voice-browser"],
    ["Computer-use checkout", "ZCodeProject/typesafe-computer-use"],
    ["Fast compaction checkout", "ZCodeProject/fast-jev-compaction"],
    ["Ultrafast browser checkout", "ZCodeProject/jev-ultrafast"],
    ["GrokBot research pilot checkout", "ZCodeProject/GrokBot-jev-research-pilot"],
  ].map(async ([name, location]) => ({ name, location, present: await present(path.join(home, location)) })));
  const harnesses = [
    { ...summarize("Codex", "Attributed receipts plus unpersisted current history", options.store ? [...saved.filter(r => r.source === "router" && r.harness === "codex").map(toRow), ...codexRows.filter(r => unsavedRows.includes(r))] : codexRows), note: "Captured JEV router decisions only, not Codex task tokens. Legacy receipts without harness metadata remain in the combined total." },
    { ...summarize("Claude Code / unidentified router sessions", "Other current router session histories", otherRouterRows), note: "Claude uses session IDs; filenames alone do not establish harness identity. These records are not automatically attributed to Claude." },
    ...sources.filter(s => s.name === "Hermes decision log" || s.name === "JEV-MAC classification" || s.name.startsWith("Project:")).map(s => ({ ...s, note: s.warnings.join(" ") })),
    ...["Kimi", "GLM", "Other harnesses"].map(name => ({ ...summarize(name, "No dedicated attributable receipt adapter", []), note: "No attributable usage available. This is not zero usage. Import explicit project receipts; model names alone do not identify a harness." })),
  ];
  const daily: UsageSource["daily"] = {};
  for (const source of sources) for (const [date, value] of Object.entries(source.daily)) {
    const day = daily[date] ??= { input: 0, output: 0, records: 0 };
    day.input += value.input; day.output += value.output; day.records += value.records;
  }
  return {
    collectedAt: new Date().toISOString(), sources, features: catalog, installations, harnesses, daily,
    receiptCoverage: {
      total: saved.length,
      harnessAttributed: saved.filter(r => r.harness && r.harness !== "unknown").length,
      projectTagged: saved.filter(r => r.project !== "unattributed").length,
      durationMeasured: saved.filter(r => r.durationMs !== undefined).length,
      taskOutcomes: saved.filter(r => r.outcome === "success" || r.outcome === "failure").length,
    },
    totalInput: sources.reduce((n, s) => n + s.input, 0), totalOutput: sources.reduce((n, s) => n + s.output, 0),
    meteredRecords: sources.reduce((n, s) => n + s.metered, 0),
    unmeteredRecords: sources.reduce((n, s) => n + s.records - s.metered, 0),
    baselineTokens: null, measuredSavings: null,
    coverage: "Partial local evidence only. Installation date, full provider usage, downstream model tokens, deleted/rotated logs and project attribution are not established. No paid API calls were made.",
  };
}
