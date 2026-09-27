# Verification ledger

Platform: this Apple Silicon Mac, Node 26.10.0; no runtime replacement.

## Executed so far

- Native helper compiled with Apple's clang.
- TypeScript strict typecheck and Vite production build passed.
- 45 node tests passed, including kept-copy revalidation, ignored-group persistence, protected instruction files, folder picker boundaries, Doctor, HTTP/MCP, approval and recovery regressions.
- Eight actual Chrome browser tests passed: duplicate keep/select/ignore/preview/quarantine/restore, point-and-click onboarding, empty/demo, scan/catalog, copy-plan approval,
  quarantine/restore, held stopping-state and stop/rescan/daemon restart/reconnect.
- Folder picker browser tests inject a synthetic chooser result; they do not automate the
  real macOS chooser. Cancellation and choosing alone never register a root or start a scan.
- Synthetic macOS files retained content, mode, mtime and extended attributes after
  quarantine/restore; copy preservation tested too.
- Real MCP stdio client negotiated the protocol, listed constrained tools and read the
  same catalog; unsupported apply tool rejected. HTTP tests check authentication,
  Origin isolation, agent approval denial and a second-daemon lock.
- The automated MCP workflow scans an approved synthetic root, previews an organization
  plan and classification payload, rejects root/apply/restore/upload tools, cancels a
  deterministically held engine job, and rescans successfully. It verifies the plan stays
  pending, no operations occur, and source contents and directory entries stay unchanged.
  The held cancellation job is synthetic work, not a large-file scan performance test.
- Codex CLI 0.157.0 accepted an inline, non-persistent stdio MCP registration and a real
  model-driven session invoked `jev_mac_status` exactly once against an isolated catalog.
  It correctly reported no approved roots, files or active jobs. No normal Codex config
  or personal folder was changed for this compatibility check.
- Claude Code 2.1.283 accepted a strict, temporary MCP configuration and its real
  model-driven session invoked only `jev_mac_status`, correctly reporting the same empty
  isolated catalog. Kimi Code 2.1.1 accepted a temporary project MCP configuration after
  its explicit workspace-trust gate; its model-driven status call returned no roots,
  files or jobs. The temporary MCP file and catalog were removed afterward.
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
- Codex, Claude Code and Kimi registration/model-driven status workflows are verified.
  Their full model-driven scan/plan/cancel flows remain untested; the automated MCP
  workflow above establishes transport/engine behavior, not that per-client acceptance gate.
  No standalone glm executable was found; GLM needs a chosen host client.
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
