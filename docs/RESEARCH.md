# Research and reuse — 2026-09-27

Scope: targeted upstream review, not a security certification or exhaustive GitHub survey.
No complete Jev-based whole-Mac organizer/doctor/cleanup system was established.

| Project | Evidence / usefulness | Decision |
| --- | --- | --- |
| [jev-organize](https://github.com/nexibeo/jev-organize) | MIT; document taxonomy, exact duplicate hashes, catalogs and organized copies. Reviewed README, config, Jev transport and apply implementation. | Vendor only its config as a non-executed design reference. Adapt taxonomy later for Mac assets. |
| [jev-the-janitor](https://github.com/kylehovance-ai/jev-the-janitor) | MIT; Markdown vault classification, review queues, budget and journal patterns. Not a general Mac cleaner. | Learn from review/budget concepts; no code copied. Author benchmark claims not independently verified. |
| [jev-mcp](https://github.com/rashedInt32/jev-mcp) | MIT; typed Jev judgments through MCP, not file management. | Reference for integration; no code copied or installed. |
| [Czkawka](https://github.com/qarmin/czkawka) | Duplicate and similar-media tooling. Inspected core Cargo manifest declares MIT; repository also has separately licensed assets. | Evaluate optional CLI backend later. Verify selected component/version license before distribution. No whole-repo license assumption or vendoring. |

Pinned reviewed references:
- jev-organize: 1693ad1939341747da4f15fd605b513eb0177c57
- jev-the-janitor: cab369b75de9a39522816af70d4cecfcbb08c231
- jev-mcp: 570c15789e2e1e3380547a78e76211d4f8cbab27

## Why not copy the organizer's execution engine?

The reviewed apply module organizes copies/links rather than implementing safe cleanup.
Its catalog paths need stronger containment validation for our threat model; its hash
helper reads whole files, unsuitable for large videos. It does not provide our required
scan-to-apply source revalidation. These are suitability findings, not claims of an
exploitable upstream vulnerability.

Its Jev transport uses OpenRouter and lacks our required cancellation/timeout/budget
controls. We will verify TypeSafe's current API contract before implementing a provider
adapter, reuse existing credentials only with an explicit configuration source, and
never log secret values. No provider compatibility is presumed.

## Copied material

references/upstream/jev-organize/config.mjs is an unchanged, pinned reference.
Its original MIT license is included beside it. It is not imported by an application.
The company-oriented categories are examples, not the final Mac cleanup policy.
No upstream safety thresholds are accepted as permission to delete.

## Remaining research gates

- Validate Jev API, pricing and typed response/error schema against current upstream docs.
- Benchmark local extraction and hashing on Apple Silicon using synthetic media.
- Evaluate macOS Trash/restore and metadata behavior across APFS and external volumes.
- Confirm each target harness supports our selected MCP transport and approval flow;
  GLM is a model backend, so integration depends on its host client.

