import { test } from "node:test";
import assert from "node:assert/strict";
import { Pairing } from "../src/pairing.ts";

test("connection codes expire, replace, lock out and redeem once", () => {
  let now = 0;
  const pairing = new Pairing(() => now);
  const first = pairing.create();
  assert.equal(pairing.redeem(first.code.toLowerCase()), true);
  assert.equal(pairing.redeem(first.code), false);
  const expired = pairing.create(); now = 120_000;
  assert.equal(pairing.redeem(expired.code), false);
  const old = pairing.create(), current = pairing.create();
  assert.equal(pairing.redeem(old.code), false);
  assert.equal(pairing.redeem(current.code), true);
  const locked = pairing.create();
  for (let i = 0; i < 5; i++) assert.equal(pairing.redeem(null), false);
  assert.equal(pairing.redeem(locked.code), false);
});
