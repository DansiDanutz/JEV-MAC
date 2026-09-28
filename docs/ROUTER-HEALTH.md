# Router Health

The Router Health sidebar tab provides an authenticated, browser-only local check:
known npm installation version, the latest five durable metered router receipts,
and POSIX modes of the temporary router directory and up to 100 JSON files.
It never reads log bodies, API keys or prompts, changes permissions, launches a
router, or makes paid calls. Missing/unsafe/incomplete checks are not a pass.
ACLs, parent-directory permissions and other security controls are not audited.

Receipt dates and models are historical evidence, not process liveness or proof
of task correctness. The linked upstream watchlist is dated, not a live issue feed.
Router launch commands are documentation, not executable buttons.

The manual September 28 test in the development conversation returned 4 from
gpt-6-luna and produced a 1,785-token JEV receipt. That test is not a general
Claude/tool-loop/reliability or savings guarantee. The UI derives its evidence
from local receipts rather than hardcoding the test as a permanent green status.
