// App-lifetime polling, not a new system daemon. Never overlaps collection runs.
export function startUsageRecorder(collect: () => Promise<unknown>, intervalMs = 15_000) {
  let enabled = true, stopped = false;
  let pending: Promise<void> | undefined;
  let lastCompletedAt: string | null = null;
  let lastError: string | null = null;
  function capture(): Promise<void> {
    if (stopped || !enabled) return Promise.resolve();
    if (pending) return pending;
    pending = Promise.resolve().then(collect).then(() => {
      lastCompletedAt = new Date().toISOString(); lastError = null;
    }, () => { lastError = "Local usage collection failed; existing receipts were preserved."; }).finally(() => { pending = undefined; });
    return pending;
  }
  const timer = setInterval(() => { void capture(); }, intervalMs);
  timer.unref();
  void capture();
  return {
    capture,
    status: () => ({ enabled, intervalMs, lastCompletedAt, lastError, running: Boolean(pending), scope: "Known local JEV logs only; while JEV-MAC is running. No paid calls or file scans." }),
    setEnabled(value: boolean) { enabled = value; if (value) void capture(); },
    async close() { stopped = true; clearInterval(timer); await pending; },
  };
}
