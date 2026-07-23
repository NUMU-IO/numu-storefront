/**
 * BYOT bundle provenance — the allowlist + digest helpers, shared by BOTH
 * load paths.
 *
 * Extracted from `external-loader.ts` (which is `"use client"`) so the
 * server-side theme SSR worker can enforce the SAME rules without a second
 * implementation. A second copy of a trust boundary is how trust boundaries
 * drift; there is exactly one here.
 *
 * The backend already gates which URLs can be persisted on
 * `external_theme.bundle_url` (NUMU-api `_allowed_bundle_hosts()`); this is
 * defense in depth for rows inserted by anything that bypassed Pydantic.
 *
 * Trust gates:
 *   1. Production URLs must be HTTPS, host must match `*.numueg.app`/`*.numu.io`
 *      or a configured CDN host (env: NEXT_PUBLIC_BYOT_BUNDLE_HOSTS).
 *   2. Optional SHA-256 verification when a digest is known.
 *   3. localhost / `*.r2.dev` are allowed only outside production.
 *
 * No DOM, no React, no Node-only APIs — safe to import from a Server
 * Component, a Client Component, or a plain Node child process.
 */

const PROD_HOST_SUFFIXES_BUILTIN = ["numueg.app", "numu.io"];
const DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);
// The dev R2 canary serves theme bundles over the managed r2.dev subdomain
// (pub-<hash>.r2.dev). DEV-ONLY — production theme delivery uses
// cdn.numueg.app via NEXT_PUBLIC_BYOT_BUNDLE_HOSTS, never r2.dev.
const DEV_HOST_SUFFIXES = ["r2.dev"];

export function isProdEnv(): boolean {
  // "production" = any environment where dev-only hosts are forbidden.
  // Explicit NEXT_PUBLIC_NUMU_ENV always wins so a built bundle can be served
  // on a dev machine for smoke tests without rebuilding. Otherwise NODE_ENV.
  const explicit = process.env.NEXT_PUBLIC_NUMU_ENV;
  if (explicit === "production") return true;
  if (explicit === "development" || explicit === "staging") return false;
  return process.env.NODE_ENV === "production";
}

export function allowedHostSuffixes(): string[] {
  const builtin = [...PROD_HOST_SUFFIXES_BUILTIN];
  const extras = process.env.NEXT_PUBLIC_BYOT_BUNDLE_HOSTS ?? "";
  for (const raw of extras.split(",")) {
    const h = raw.trim().toLowerCase().replace(/^\*\./, "");
    if (h) builtin.push(h);
  }
  return builtin;
}

/**
 * Validate a URL against the BYOT allowlist. Returns true if loading is
 * permitted, false otherwise. Does NOT throw — the caller decides how to
 * surface the rejection.
 */
export function isAllowedBundleUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  const inDev = !isProdEnv();

  if (inDev) {
    if (DEV_HOSTS.has(host)) return true;
    // r2.dev canary bundles (https) are allowed in dev only.
    if (DEV_HOST_SUFFIXES.some((s) => host === s || host.endsWith("." + s)))
      return true;
  }

  if (parsed.protocol !== "https:") return false;
  return allowedHostSuffixes().some(
    (suffix) => host === suffix || host.endsWith("." + suffix),
  );
}

/**
 * SHA-256 hex digest of a buffer, for SRI verification against the digest the
 * marketplace stored on the version row. `crypto.subtle` is available in both
 * the browser and Node ≥18, so this one implementation serves both paths.
 */
export async function sha256Hex(
  buffer: ArrayBuffer | Uint8Array,
): Promise<string> {
  const data =
    buffer instanceof Uint8Array
      ? (buffer.buffer.slice(
          buffer.byteOffset,
          buffer.byteOffset + buffer.byteLength,
        ) as ArrayBuffer)
      : buffer;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * A bare `from "./chunk.js"` / `import("./chunk.js")` in a built bundle — the
 * signature of a code-split build whose sibling chunks a single stored
 * checksum does not cover. Verifying the entry alone there would grant false
 * confidence (luxury-minimal 0.3.3 published a 94-byte entry importing
 * `./main-*.js`), so both load paths refuse such bundles under enforcement.
 */
export const RELATIVE_IMPORT = /(?:from|import)\s*\(?\s*["']\.\.?\//;
