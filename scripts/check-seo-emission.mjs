/**
 * Self-check for the GEO/AEO emission logic.
 *
 * This repo has no unit runner — only Playwright e2e, which needs a live
 * server and a real store. The logic worth pinning here is pure and cheap to
 * exercise directly, so it is bundled with the esbuild that already ships in
 * devDependencies and run under `node:assert`. No new dependency, no config.
 *
 *   node scripts/check-seo-emission.mjs
 *
 * Covers the two things that are wrong in a way nobody would notice: an
 * FAQPage published with no questions (an invalid entity, worse than none),
 * and an AI-crawler gate that opens for a store which blocks indexing.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";

const dir = mkdtempSync(join(tmpdir(), "numu-seo-check-"));

// One bundle per module: esbuild refuses a single `outfile` for several
// entry points, and these two are independent anyway.
async function load(entry, name) {
  const outfile = join(dir, `${name}.mjs`);
  await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "neutral",
    outfile,
    // Both modules are otherwise standalone; next/* is only a type import.
    external: ["next", "next/*"],
    logLevel: "silent",
  });
  return import(`file://${outfile}`);
}

const { buildFaqLd, buildOrganizationLd } = await load(
  "src/lib/json-ld.ts",
  "json-ld",
);
const { storeAllowsAiCrawlers } = await load("src/lib/seo.ts", "seo");

const BASE = "https://vionne.numueg.app";

// ── FAQPage ────────────────────────────────────────────────────────────────
assert.equal(buildFaqLd(BASE, null), null, "no faqs → no FAQPage");
assert.equal(buildFaqLd(BASE, []), null, "empty faqs → no FAQPage");
assert.equal(
  buildFaqLd(BASE, [{ question: "  ", answer: "x" }]),
  null,
  "a blank question is not a question",
);

const faq = buildFaqLd(BASE, [
  { question: " Do you deliver to Aswan? ", answer: " Yes, 3-5 days. " },
  { question: "", answer: "dropped" },
]);
assert.equal(faq["@type"], "FAQPage");
assert.equal(faq.mainEntity.length, 1, "blank pairs are dropped");
assert.equal(faq.mainEntity[0].name, "Do you deliver to Aswan?");
assert.equal(faq.mainEntity[0].acceptedAnswer.text, "Yes, 3-5 days.");

// ── Organization ───────────────────────────────────────────────────────────
const org = buildOrganizationLd({
  baseUrl: BASE,
  storeName: "Vionne",
  socialLinks: { instagram: "https://instagram.com/vionne" },
  declaredProfiles: ["https://instagram.com/vionne", "not-a-url"],
  email: "hello@vionne.example",
  telephone: "+201000000000",
  areaServed: [" Egypt ", ""],
  foundingYear: 2024,
});
// One entry, not two: the derived and declared copies canonicalise to the
// same URL (canonicalizeSocialUrl adds the www. host form), and listing a
// profile twice weakens the signal rather than doubling it.
assert.deepEqual(
  org.sameAs,
  ["https://www.instagram.com/vionne"],
  "declared and derived profiles dedupe; a bare handle is dropped",
);
assert.equal(org.contactPoint["@type"], "ContactPoint");
assert.deepEqual(org.areaServed, ["Egypt"]);
assert.equal(org.foundingDate, "2024");

const bare = buildOrganizationLd({ baseUrl: BASE, storeName: "Vionne" });
for (const key of ["contactPoint", "email", "telephone", "areaServed", "foundingDate"]) {
  assert.ok(!(key in bare), `${key} is not claimed when unset`);
}

// ── AI crawler gate ────────────────────────────────────────────────────────
assert.equal(storeAllowsAiCrawlers(null), false, "no store → closed");
assert.equal(
  storeAllowsAiCrawlers({ status: "active" }),
  true,
  "unconfigured store is citable",
);
assert.equal(
  storeAllowsAiCrawlers({ status: "active", seo: { ai_crawlers_allowed: false } }),
  false,
);
assert.equal(
  storeAllowsAiCrawlers({ status: "suspended" }),
  false,
  "a store that blocks indexing does not offer itself to answer engines",
);
assert.equal(
  storeAllowsAiCrawlers({
    status: "active",
    seo: { robots_indexing_enabled: false, ai_crawlers_allowed: true },
  }),
  false,
  "noindex wins over an ai_crawlers_allowed left at true",
);

rmSync(dir, { recursive: true, force: true });
console.log("seo emission checks passed");
