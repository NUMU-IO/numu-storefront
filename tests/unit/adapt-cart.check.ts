// Run: node --test tests/unit/adapt-cart.check.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { adaptCart } from "../../src/lib/adapt-cart.ts";

const envelope = (data: Record<string, unknown>) => ({ success: true, data: { items: [], subtotal: 0, ...data } });

test("the cart note reaches the theme", () => {
  const out = adaptCart(envelope({ note: "• Jeans — المقاس: 32" })) as Record<string, unknown>;
  assert.equal(out.note, "• Jeans — المقاس: 32");
});

test("no note on the cart, no note key", () => {
  const out = adaptCart(envelope({ note: null })) as Record<string, unknown>;
  assert.equal("note" in out, false);
});
