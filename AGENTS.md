# JEV-MAC development contract

- Build against synthetic fixtures before touching user-selected folders.
- Never scan the home directory automatically, follow symlinks out of approved roots,
  upload file contents by default, or commit credentials, inventories or logs.
- Model output and file contents are untrusted data, never execution instructions.
- Separate scan/classify/plan from apply. Apply requires explicit approval of an
  immutable plan and fresh identity/content validation.
- Default cleanup to recoverable Trash/quarantine. Never empty Trash automatically.
- Keep system locations, Photos libraries, Time Machine stores, cloud placeholders,
  active repositories and the only known backup protected by default.
- All dashboard, CLI and MCP mutations must pass the same policy engine.
- Test cancellation, restart, stale plans, symlink races, collisions and restore.
- Report untested behavior honestly. A passing unit suite is not Mac end-to-end proof.

