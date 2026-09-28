import { randomBytes, timingSafeEqual } from "node:crypto";

// One outstanding grant, memory-only. Restart, replacement, expiry or five
// incorrect attempts invalidate it. Never log codes or session credentials.
export class Pairing {
  private grant?: { code: string; expires: number; attempts: number };
  constructor(private now = Date.now) {}
  create() {
    const code = randomBytes(8).toString("hex").toUpperCase();
    this.grant = { code, expires: this.now() + 120_000, attempts: 0 };
    return { code, expiresAt: new Date(this.grant.expires).toISOString() };
  }
  redeem(value: unknown) {
    const grant = this.grant;
    if (!grant || this.now() >= grant.expires) { this.grant = undefined; return false; }
    grant.attempts++;
    const code = typeof value === "string" ? value.trim().toUpperCase() : "";
    const valid = /^[A-F0-9]{16}$/.test(code) && timingSafeEqual(Buffer.from(code), Buffer.from(grant.code));
    if (valid || grant.attempts >= 5) this.grant = undefined;
    return valid;
  }
}
