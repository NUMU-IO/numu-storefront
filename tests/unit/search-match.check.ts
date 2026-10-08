// Run: node --test tests/unit/search-match.check.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { matchesQuery } from "../../src/lib/search-match.ts";

const shirt = {
  name: "Cotton Shirt",
  description: "Soft summer fabric",
  sku: "VN-0042",
  tags: ["linen", "Summer"],
  attributes: { nameAr: "تيشيرت قطن", descriptionAr: "قماش صيفي" },
};

test("ZERO-U-05: name, description, tag and SKU each match alone, any case", () => {
  for (const q of ["cotton", "SUMMER FABRIC", "linen", "vn-0042"]) {
    assert.equal(matchesQuery(shirt, q), true, q);
  }
  assert.equal(matchesQuery(shirt, "zzzzqqq"), false);
});

test("ZERO-U-06: the Arabic name and description match", () => {
  assert.equal(matchesQuery(shirt, "تيشيرت"), true);
  assert.equal(matchesQuery(shirt, "صيفي"), true);
  assert.equal(matchesQuery({ name: "Cotton Shirt" }, "تيشيرت"), false);
});

test("ZERO-U-07: empty and whitespace queries match nothing and never throw", () => {
  assert.equal(matchesQuery(shirt, ""), false);
  assert.equal(matchesQuery(shirt, "   "), false);
  assert.equal(matchesQuery({}, "x"), false);
  assert.equal(matchesQuery({ name: null, tags: "not-an-array", attributes: 7 }, "x"), false);
});

test("ZERO-U-08: everything the old name+description match found still matches", () => {
  const old = (p: { name?: string; title?: string; description?: string }, q: string) =>
    `${p.name ?? p.title ?? ""} ${p.description ?? ""}`.toLowerCase().includes(q.toLowerCase());
  const rows = [shirt, { title: "Bag" }, { name: "Mug", description: "Blue" }, {}];
  for (const p of rows) {
    for (const q of ["shirt", "t s", "bag", "mug blue", "blue", "o"]) {
      if (old(p, q)) assert.equal(matchesQuery(p, q), true, `${JSON.stringify(p)} / ${q}`);
    }
  }
});
