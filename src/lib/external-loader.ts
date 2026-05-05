"use client";

/**
 * External BYOT theme loader.
 *
 * Loads a theme bundle by URL and (optionally) its CSS. The backend already
 * gates which URLs can be persisted on `external_theme.bundle_url` (see
 * NUMU-api `_allowed_bundle_hosts()`), but we re-validate at the client
 * boundary as defense in depth — if a row is inserted by an admin tool that
 * bypasses Pydantic, this loader still refuses to fetch from arbitrary hosts.
 *
 * Trust gates:
 *   1. Production URLs must be HTTPS, host must match `*.numueg.app` or one
 *      of the configured CDN hosts (env: NEXT_PUBLIC_BYOT_BUNDLE_HOSTS).
 *   2. Optional SHA-256 checksum: when the marketplace `version.checksum`
 *      is supplied, we fetch + verify before evaluating.
 *   3. Localhost is allowed only when NEXT_PUBLIC_NUMU_ENV !== "production".
 */

const PROD_HOST_SUFFIXES_BUILTIN = ["numueg.app", "numu.io"];
const DEV_HOSTS = new Set(["localhost", "127.0.0.1"]);

function isProdEnv(): boolean {
  // We treat "production" as any environment where dev-only hosts are
  // forbidden. Use NEXT_PUBLIC_NUMU_ENV to override (e.g., for staging
  // smoke tests that want to allow localhost).
  return (
    process.env.NEXT_PUBLIC_NUMU_ENV === "production" ||
    process.env.NODE_ENV === "production"
  );
}

function allowedHostSuffixes(): string[] {
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
 * permitted, false otherwise. Does NOT throw — caller decides how to surface
 * the rejection.
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

  if (inDev && DEV_HOSTS.has(host)) return true;

  if (parsed.protocol !== "https:") return false;
  return allowedHostSuffixes().some(
    (suffix) => host === suffix || host.endsWith("." + suffix),
  );
}

/**
 * Compute the SHA-256 hex digest of a buffer. Used for SRI verification
 * when the marketplace stores a checksum on the version row.
 */
async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface LoadOptions {
  /** Optional SHA-256 hex digest to verify the bundle against. When set,
   *  any mismatch rejects the load (the bundle is never evaluated). */
  expectedChecksum?: string | null;
}

/**
 * Load an external BYOT theme bundle. Returns the module's default export
 * (the theme component tree). Rejects if the URL is not on the allowlist
 * or if the optional checksum doesn't match.
 */
export async function loadExternalTheme(
  bundleUrl: string,
  options: LoadOptions = {},
): Promise<unknown> {
  if (!isAllowedBundleUrl(bundleUrl)) {
    throw new Error(`Refusing to load bundle from disallowed host: ${bundleUrl}`);
  }

  // If we have a checksum, fetch the bundle bytes first, verify, then
  // create a blob URL we can dynamically import. This keeps untrusted JS
  // from running before verification.
  if (options.expectedChecksum) {
    const res = await fetch(bundleUrl, { cache: "force-cache" });
    if (!res.ok) {
      throw new Error(
        `Bundle fetch failed: ${res.status} ${res.statusText}`,
      );
    }
    const bytes = await res.arrayBuffer();
    const got = await sha256Hex(bytes);
    if (got !== options.expectedChecksum.toLowerCase()) {
      throw new Error(
        `Bundle checksum mismatch (expected ${options.expectedChecksum}, got ${got})`,
      );
    }
    const blobUrl = URL.createObjectURL(
      new Blob([bytes], { type: "application/javascript" }),
    );
    try {
      const mod = await dynamicImport(blobUrl);
      return (mod as { default?: unknown })?.default ?? mod;
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  // No checksum: still apply the allowlist gate above, then import directly.
  const mod = await dynamicImport(bundleUrl);
  return (mod as { default?: unknown })?.default ?? mod;
}

/**
 * Import a module by URL while sidestepping bundler static analysis.
 * Both webpack/Turbopack and Vite try to resolve every literal `import(...)`
 * at build time, even with magic comments. Wrapping the call in `new Function`
 * defeats that by hiding the dynamic specifier from the analyzer.
 */
function dynamicImport(url: string): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
  const fn = new Function("u", "return import(u);") as (
    u: string,
  ) => Promise<unknown>;
  return fn(url);
}

/**
 * Load external CSS for a BYOT theme. Idempotent: a second call with the
 * same URL is a no-op. Refuses URLs not on the allowlist.
 */
export function loadExternalCSS(cssUrl: string): void {
  if (typeof document === "undefined") return;
  if (!isAllowedBundleUrl(cssUrl)) {
    console.warn(`[loadExternalCSS] Refusing disallowed host: ${cssUrl}`);
    return;
  }
  // Iterate rather than interpolate — quotes/brackets in a URL would break
  // a `link[href="..."]` selector and could be a future XSS sink.
  const links = document.querySelectorAll(
    'link[rel="stylesheet"][data-numu-theme="external"]',
  );
  for (const el of Array.from(links)) {
    if ((el as HTMLLinkElement).href === cssUrl) return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = cssUrl;
  link.setAttribute("data-numu-theme", "external");
  document.head.appendChild(link);
}
