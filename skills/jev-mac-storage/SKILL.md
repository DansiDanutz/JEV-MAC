---
name: jev-mac-storage
description: Audit Mac disk headroom and plan recoverable storage reduction using JEV-MAC, including file archives, apps, backups and GitHub project recovery checks.
---

# Mac storage review

JEV-MAC checkout: `/Users/davidai/ZCodeProject/JEV-MAC`. Read its AGENTS.md.
Use Local Storage for volume headroom and the connected-folder catalog. Opening
the page does not scan the Mac or authorize removal. Label incomplete coverage.

## Evidence before removal

- Refresh the catalog for selected roots. Rank allocated and logical sizes
  separately; APFS clones, sparse files, hard links and snapshots invalidate
  naive sums. Never promise logical bytes as savings.
- Use the existing JEV metadata-preview and consent flow to categorize selected
  files. File contents and paths stay local except the exact approved payload.
  JEV is advisory: its output cannot grant permission, prove disuse or override
  protected paths. Do not reuse an earlier test budget for new paid calls.
- Modification age is not last use. A duplicate hash does not prove an app or
  project can function without that path. Preserve active repositories, system
  data, secrets, cloud placeholders, Photos and Time Machine.

## Archives

Choose an explicit archive destination with enough free space, preferably a
separate volume. Preview the exact file manifest and exclusions. Preserve
metadata and symlinks without following them. Create without deleting sources,
test extraction in a separate location, verify content hashes and required
metadata, record the restore command, then request source-removal approval.
An archive on the same disk is not an independent backup.

## GitHub project offload

A clean worktree or origin URL is insufficient. Check all branches, tags,
unpushed commits, stashes, untracked AND ignored files, worktrees, submodules,
Git LFS objects, local databases, environment files, build assets and licenses.
Require remote reachability and a clean-room clone/restore test at the recorded
commit. Remote-tracking refs can be stale. Never push secrets to make a project
"backed up". Store local-only essentials in an approved encrypted backup, not Git.
Block offload if any recovery requirement is unknown. Repository removal is
never automated by the current Local Storage tab.

## Apps and backups

Inventory apps read-only before suggesting uninstall. Verify the reinstall
source, licenses, documents, support data and running agents/services. Use the
vendor uninstaller when appropriate, with explicit approval. Never recursively
purge Library or shared package stores. Verify an independent backup restore;
newer dates and matching names do not prove supersession.

## Apply and future work

Use JEV-MAC's immutable approved plans and identity/content revalidation for
supported file operations. Do not bypass its policy engine with shell deletion.
Quarantine does not free space until independently purged; never empty Trash.
Report actual free-space change after approved operations. Keep a planning
reserve of max(20 GiB, 10% of the volume), labelled as a heuristic, and check
before large builds/downloads. Schedule monitoring only when requested.

Current tab supports catalog review, headroom and JEV preview, not archive
execution, app uninstalls, backup purges or verified project offload. State those
limits explicitly rather than presenting instructions as implemented features.
