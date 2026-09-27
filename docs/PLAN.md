# JEV-MAC build plan

## Product and boundaries

A local dashboard for on-demand organization, storage diagnosis and cleanup.
No voice/browser automation dependency. No automatic startup scan or background deletion.
The first release is an evidence-backed review tool; mutations follow only after recovery
tests pass. Work in small milestones with demonstrable outcomes.

Dashboard areas:
1. Overview: approved roots, scan progress, estimated storage and last successful run.
2. Files: searchable catalog, category, origin/project, evidence and confidence.
3. Review: duplicates, possible obsolete versions, screenshots and unused-media candidates.
4. Organize: preview proposed destinations, collision handling and approval.
5. Doctor: read-only findings, explanation, severity and narrowly scoped suggested remedies.
6. History: job state, approved operations, failures and restore.
7. Settings: exclusions, privacy, Jev budget and agent access.

## Architecture

Proposed baseline: TypeScript local service, SQLite catalog, React dashboard and bounded
worker jobs. Verify a supported Node LTS and SQLite choice before implementation; do not
silently change the machine's runtime.

Dashboard / CLI / MCP -> shared job API -> policy engine -> local scanner and operation journal.
Jev is a classification adapter, not a filesystem executor. Local hashing, extraction and
reference analysis produce evidence first. All clients share durable state and locks.

Bind loopback only. Choose and persist an available unprivileged port, not the retired
54873 dashboard port. Do not claim a port has never previously been used. Require local
session authentication, validate Origin/Host, prevent CSRF/DNS-rebinding, and never expose
a generic shell or arbitrary filesystem-write endpoint. Keep keys server-side; redact errors.
No launch agent, login item, remote listener or system configuration changes by default.

## Catalog and classification

Store file identity (volume/device/inode), path, size, timestamps, streamed content hash,
metadata, extraction version, scan generation and evidence. Distinguish logical size from
allocated storage: APFS clones and hardlinks can make apparent duplicate savings misleading.

Jev returns schema-validated category, proposed disposition, explanation and uncertainty:
- active project / archived project / possible superseded version
- original asset / generated output / screenshot / document / backup
- exact duplicate / visually similar candidate / reference unknown
- retain / review / organize candidate / cleanup candidate

Low confidence always goes to review. Confidence is not proof of disposability.
Age and last access alone never mean unused. A newer backup does not prove coverage.
Compare repository history, dirty/unpushed state, file manifests and unique content before
suggesting project or backup redundancy. Never destroy the only known copy.

Media references can be dynamic, external or embedded in proprietary projects: absence of
a textual reference is not proof of orphan status. Similar images/videos require review;
different edits, resolutions and metadata may all be valuable.

## Privacy and safety

Default local metadata-only analysis. Before sending anything to Jev, show what fields leave
the Mac and obtain scoped consent; content snippets, thumbnails/OCR and full text are separate
opt-ins. Redaction is best effort, not a privacy guarantee. Exclude credentials and sensitive
locations. Treat embedded prompt instructions as inert content. Provider failure leaves local
scans usable and recommendations pending, never implicitly approved.

Protect system paths, application bundles, Photos libraries, Time Machine stores, cloud-only
placeholders and other agents' checkouts. Do not hydrate cloud files silently. Scan only roots
explicitly chosen by the user; handle permission errors without escalating automatically.

An immutable plan contains exact sources/destinations, reasons, byte estimates and preconditions.
Approval covers that plan, not future changes. Revalidate identities and content immediately
before mutation; refuse stale plans. Use containment checks plus race-resistant filesystem
operations; do not rely on string-prefix checks. Never follow unexpected symlinks.

Initially offer copy-based organization and recoverable quarantine/Trash only. Keep an
operation journal before each mutation and reconcile it after crashes. Preserve metadata or
report unsupported preservation and refuse destructive fallback. Cross-volume operations require
verified copies before source removal. Restore never overwrites an existing destination.
Stop prevents new operations and safely settles an in-flight atomic operation; it must not claim
to undo already completed work. The history screen shows exactly what happened.

## Agent interface

Expose narrow versioned tools: scan, status, classify, plan, inspect_plan, apply_approved_plan,
cancel and restore. MCP and CLI call the same engine. No tool accepts raw shell commands.
Approval tokens are short-lived, plan-bound and cannot be minted by a model call.
Provide a portable SKILL.md plus per-client setup notes; install only into selected harnesses.
Test Claude Code, Codex and Kimi independently. Test GLM through the actual chosen MCP-capable
host; do not advertise compatibility from model branding alone.

## Milestones and acceptance gates

### 1 — Local skeleton and read-only scanner
Dashboard, job queue, SQLite migrations, root picker, exclusions, pagination and cancellation.
Synthetic fixtures cover large files, Unicode, permission failures, symlinks and hardlinks.
Acceptance: repeated start/stop/new scan works; restart resumes or clearly marks interrupted
jobs; no source modifications; one explicitly selected test folder demonstrated end-to-end.

### 2 — Exact duplicates and storage Doctor
Streamed hashes with bounded CPU/I/O, hardlink awareness and storage estimates. Doctor reports
large folders, regenerable build artifacts and errors; no broad cache purge or system repair.
Acceptance: known fixture duplicate sets are exact; inaccessible/changed files are reported;
no false savings counted for hardlinks; UI remains responsive.

### 3 — Jev classification and reference analysis
Validated provider adapter, payload preview, consent, rate limits, timeouts, cancellation,
cost ceiling, content/policy-version cache and uncertainty review.
Acceptance: malformed responses, missing key, quota errors and provider outage fail safely;
an opt-in live test is clearly distinguished from mocked tests. No secrets in logs.

### 4 — Organization and reversible cleanup
Plan preview, explicit approval, protected roots, journal, locks, source revalidation,
quarantine/Trash and collision-safe restore. Never permanent deletion or automatic Trash emptying.
Acceptance: stale plans and path escapes rejected; crash recovery reconciles partial operations;
restore verifies contents and supported metadata in a dedicated Mac test folder. Test cross-volume
behavior separately before enabling it. A concurrent agent cannot bypass locks or approval.

### 5 — Shared agent tools and polish
CLI/MCP, portable skill, per-harness setup, accessibility, keyboard navigation and clear status.
Acceptance: every supported client performs the same scan/plan/cancel flow against fixtures;
mutation requires the same explicit approval; UI and agent history remain consistent.

### 6 — Controlled real-data pilot
User chooses a small noncritical folder. Scan-only first, then manually reviewed plans and one
restore drill. Keep personal inventories outside Git. Expand scope only after evidence and
user acceptance, not because fixture tests passed.

## Verification and release bar

Unit tests for containment, classification validation, duplicate detection and plan policy;
integration tests for workers, database and journal recovery; browser tests for start/stop/restart,
errors and review; real macOS tests for Trash, metadata and restore. Fault-inject provider outage,
disk full, permission denial, changing source and unexpected shutdown. Measure scan throughput,
memory and cancellation latency on documented fixtures before setting performance targets.

Each milestone records changed files, commands, results and untested gaps.
A dashboard is not called working until its user-facing workflow has been exercised end-to-end.
Implementation starts with milestone 1; this planning commit contains no executable dashboard.
