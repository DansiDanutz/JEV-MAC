import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";

const run = promisify(execFile);
export async function pickFolder(location: unknown): Promise<string | null> {
  const choices: Record<string, string> = {
    downloads: "Downloads",
    desktop: "Desktop",
    documents: "Documents",
    other: "",
  };
  if (typeof location !== "string" || !Object.hasOwn(choices, location))
    throw Error("Choose a listed folder option");
  const initial = path.join(os.homedir(), choices[location]);
  const script = `on run argv
try
set selectedFolder to choose folder with prompt "Choose a folder for JEV-MAC. Nothing is scanned yet." default location (POSIX file (item 1 of argv))
return POSIX path of selectedFolder
on error number -128
return ""
end try
end run`;
  try {
    const { stdout } = await run(
      "/usr/bin/osascript",
      ["-e", script, initial],
      { timeout: 120000, maxBuffer: 8192 },
    );
    return stdout.trim() || null;
  } catch {
    throw Error(
      "The Mac folder picker could not open or timed out. Try again, or use Advanced: enter a path.",
    );
  }
}
