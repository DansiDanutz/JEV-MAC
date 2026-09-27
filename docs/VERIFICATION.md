# Verification ledger

Platform: this Apple Silicon Mac, Node 26.10.0; no runtime replacement.

## Executed so far

- Native helper compiled with Apple's clang.
- TypeScript strict typecheck and Vite production build passed.
- 41 node tests passed after cleanup, including Doctor, HTTP/MCP, approval and recovery regressions.
- Six actual Chrome browser tests passed: empty/demo, scan/catalog, copy-plan approval,
  quarantine/restore, held stopping-state and stop/rescan/daemon restart/reconnect.
- Synthetic macOS files retained content, mode, mtime and extended attributes after
  quarantine/restore; copy preservation tested too.
- Real MCP stdio client negotiated the protocol, listed constrained tools and read the
  same catalog; unsupported apply tool rejected. HTTP tests check authentication,
  Origin isolation, agent approval denial and a second-daemon lock.
- A single live TypeSafe request used only invented metadata: Screenshot demo.png,
  2048 bytes. Jev returned jev-1.13.0, category screenshot, confidence 0.92;
  635 input and 95 output tokens. No personal filenames/content were transmitted.
- Portable skill validator passed.
- Native clang static analysis passed with no diagnostics after descriptor-error checks.
- npm production dependency audit reported zero known vulnerabilities.
- Launcher zsh syntax check passed.
- Actual launcher started the service, opened its authenticated browser and answered the
  CLI status request with an empty catalog and Jev configured. No personal root was registered.
- Screenshot inspected at 1440×1000 with synthetic catalog: legible layout, actual
  counts, visible logical-size caveat and no clipped primary controls.

## Storage interruption

The OS reported ENOSPC during a build/source edit, with ~111 MB available.
Only this project's newly generated node_modules and dist were removed and subsequently
recreated from its lockfile. Source survived intact. Space later recovered above 5 GiB.
Regression tests now inject journal failures to ensure active/mutation locks release
and further jobs are fenced until storage is resolved and the service restarted.

## Not established

- No user-selected real-data pilot: the user has not supplied a specific folder path.
- No real iCloud/File Provider placeholder hydration test. Dataless preflight and
  known protected locations are guarded, but this is not platform certification.
- No cross-volume mutation support: operations remain inside one registered root;
  cross-volume rename fails safely.
- No visual near-duplicate detector, video similarity, or complete project-reference
  resolver. Bounded local text matching provides positive filename-reference evidence;
  absence of a reference is explicitly not orphan/deletion proof.
- Folder overlap is hash evidence for inspected files, not proof of backup restoration,
  version supersession, or redundancy of excluded files.
- Codex, Claude Code and Kimi executables are installed, but each app's registration
  and model-driven tool workflow has not been exercised. No standalone glm executable
  was found; GLM needs a chosen host client.
- No permanent deletion, automatic Trash emptying, system repair or background cleanup.
  Quarantine does not free space. Partial copy failures retain a .jev-part file for
  manual recovery; no unverified cleanup silently deletes it.

This ledger is deliberately not a declaration that every approved milestone is complete.

## Cleanup and review

The independent architect initially rejected the implementation. Fixes covered one-use
approval grants, root identity checks, storage-failure fencing, restore-phase recovery,
staged scan publication, stopping-state UI, repository protection and cross-volume refusal.
Re-review conditionally cleared synthetic fixtures only. The cleanup pass formatted owned
source, removed an obsolete TMPDIR test workaround, exposed partial-copy recovery paths
and checked native descriptor failures. Fresh build/tests/browser checks passed afterward.

For a failed organized copy, History shows the destination plus its `.jev-part` suffix.
Retain both until manually comparing the original and partial artifact. Partial artifacts
are never silently published or automatically removed; the original remains untouched.
