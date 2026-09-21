#!/usr/bin/env node
/**
 * Verify that a published theme bundle still hashes to what the platform
 * pinned for it (apps plan, Phase 8 item 8.1).
 *
 * Two jobs:
 *
 *   1. The pre-flight before anyone sets `NEXT_PUBLIC_BYOT_CHECKSUM_ENFORCE=1`.
 *      Enforcement fails closed, which BLANKS a live store when the pinned
 *      digest and the served bytes disagree — so the digests must be checked
 *      against the real CDN objects first, for every version a live store is
 *      actually pinned to. Run this for each, then flip the flag.
 *
 *   2. A standing check that the CDN objects have not moved under a version
 *      that is already published. Re-uploading `theme.js` in place under an
 *      existing version string is the way that happens by accident.
 *
 * Usage:
 *   node scripts/check-bundle-integrity.mjs <bundle_url> [--client <sha256>] [--server <sha256>]
 *
 * The expected digests come from the theme's version row:
 *   select checksum, server_checksum from public.marketplace_theme_versions
 *    where bundle_url = '<bundle_url>';
 * Omit either flag to just print the digest the CDN is serving.
 *
 * Exits non-zero on any mismatch, so it can gate a deploy step.
 */

import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const bundleUrl = args.find((a) => !a.startsWith("--"));
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : (args[i + 1] ?? null);
};

if (!bundleUrl) {
  console.error(
    "usage: node scripts/check-bundle-integrity.mjs <bundle_url> [--client <sha256>] [--server <sha256>]",
  );
  process.exit(2);
}

const expectedClient = flag("client");
const expectedServer = flag("server");

const sha256 = (bytes) =>
  createHash("sha256").update(Buffer.from(bytes)).digest("hex");

const siblingUrl = (name) => new URL(name, bundleUrl).toString();

async function fetchBytes(url) {
  // r2.dev refuses HEAD and non-browser user agents, so this is a plain GET
  // with a browser UA — a 403 here is usually the CDN, not the object.
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return new Uint8Array(await res.arrayBuffer());
}

let failed = false;

function compare(label, actual, expected) {
  if (!expected) {
    console.log(`${label}: ${actual}  (nothing to compare against)`);
    return;
  }
  const ok = actual === expected;
  if (!ok) failed = true;
  console.log(
    `${label}: ${ok ? "MATCH" : "MISMATCH"}\n  served:   ${actual}\n  expected: ${expected}`,
  );
}

try {
  compare("client bundle (theme.js)", sha256(await fetchBytes(bundleUrl)), expectedClient);

  let manifest = null;
  try {
    manifest = JSON.parse(
      new TextDecoder().decode(await fetchBytes(siblingUrl("manifest.json"))),
    );
  } catch (err) {
    console.log(`manifest.json: not readable (${err.message})`);
  }

  const ssr = manifest?.ssr;
  if (!ssr?.capable || !ssr.server_bundle) {
    console.log("SSR bundle: theme does not declare one — nothing to verify");
  } else {
    const served = sha256(await fetchBytes(siblingUrl(ssr.server_bundle)));
    compare("SSR bundle (theme.server.js)", served, expectedServer);
    // The manifest ships beside the bytes it describes, so it is only a
    // self-declaration — but a manifest that disagrees with the database pin
    // is exactly the signal the SSR worker refuses on, so surface it here.
    if (ssr.server_bundle_checksum) {
      compare("  manifest's own claim", ssr.server_bundle_checksum, served);
    } else {
      console.log(
        "  manifest declares no server_bundle_checksum — the SSR worker " +
          "now needs the database pin, or it refuses to render",
      );
    }
  }
} catch (err) {
  console.error(`check failed: ${err.message}`);
  process.exit(1);
}

process.exit(failed ? 1 : 0);
