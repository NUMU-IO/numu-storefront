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
// Session G (file 08): the dev R2 canary serves theme bundles over the
// managed r2.dev subdomain (pub-<hash>.r2.dev). DEV-ONLY allow-list —
// production theme delivery uses cdn.numueg.app via
// NEXT_PUBLIC_BYOT_BUNDLE_HOSTS, never r2.dev.
const DEV_HOST_SUFFIXES = ["r2.dev"];

/**
 * Is bundle-checksum verification enforced?
 *
 * OFF by default, deliberately. Verification fails CLOSED — a mismatch throws
 * and the storefront renders the theme error state instead of the shop — so
 * anything that changes the delivered bytes without updating the stored digest
 * (a CDN that minifies or injects, a bundle re-uploaded in place) would take a
 * live store down. House rule for theme changes is to feature-flag them, so
 * this ships dark: the digest is plumbed end to end and can be validated
 * against real CDN-served bytes on the test stack, then switched on.
 *
 * Set NEXT_PUBLIC_BYOT_CHECKSUM_ENFORCE=1 to enforce. It doubles as the kill
 * switch — flip it back to 0 to restore service without a rollback.
 *
 * Note the gate is only reachable for themes activated after the digest was
 * added to the activation payload; earlier installs carry no checksum and are
 * unaffected either way.
 */
function isChecksumEnforced(): boolean {
  return process.env.NEXT_PUBLIC_BYOT_CHECKSUM_ENFORCE === "1";
}

function isProdEnv(): boolean {
  // We treat "production" as any environment where dev-only hosts are
  // forbidden. Explicit NEXT_PUBLIC_NUMU_ENV always wins so a built
  // bundle can be served on a dev machine for smoke tests without
  // rebuilding (set NEXT_PUBLIC_NUMU_ENV=development or =staging in
  // the host's env). Otherwise fall back to NODE_ENV.
  const explicit = process.env.NEXT_PUBLIC_NUMU_ENV;
  if (explicit === "production") return true;
  if (explicit === "development" || explicit === "staging") return false;
  return process.env.NODE_ENV === "production";
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

interface BundleImportMap {
  plugin: string;
  federate: boolean;
  sdk_compat_major: number;
  /** Optional (plugin >= the minor-gate release). In the pre-1.0 SDK line
   *  minors are breaking, so this pins the exact minor the bundle was built
   *  against. Absent on older bundles → the minor check is skipped. */
  sdk_compat_minor?: number;
  host_provided: string[];
}

interface HostRuntimeManifest {
  sdk_version: string;
  react_version: string;
}

/**
 * Fetch the import-map.json the plugin emits alongside theme.js. When
 * federate=true, the bundle imports `react`, `@numu/theme-sdk`, etc.
 * as bare specifiers — the host MUST provide compatible versions, or
 * the bundle's hooks will throw on first call. We verify the major
 * matches before evaluating any bundle JS.
 *
 * Failures (network, parse error, mismatch) reject the load with a
 * clear message. Bundles with `federate: false` skip the check
 * (self-contained — they don't depend on the host runtime).
 */
// Local-dev QA serves theme bundles from a STABLE URL (`:5173/theme.js`) whose
// CONTENT changes on every rebuild — so `force-cache` replays a stale bundle
// (its hashed chunks 404 → the theme's sections, incl. the header, silently
// vanish). Fetch fresh in development; keep `force-cache` in production where
// bundle URLs are versioned + immutable (and caching is correct + fast).
const BUNDLE_CACHE: RequestCache =
  process.env.NEXT_PUBLIC_NUMU_ENV === "development" ? "no-store" : "force-cache";

// Bound the tiny theme-metadata fetches (import-map.json, manifest.json). A
// hang here is worse than a failure: the boundary's reveal deadline tears the
// skeleton down but the bundle never mounts, so the page silently goes blank
// with NO error thrown. Timing out converts that into a fast, surfaced failure
// (import-map falls back to "self-contained"; the manifest fetch rejects with a
// clear compat error → error UI + telemetry). The large bundle download below
// is intentionally left untimed — a naive timeout would false-abort slow-but-
// healthy downloads, and its sibling non-checksum import() path takes no signal.
const THEME_META_TIMEOUT_MS = 8_000;

async function loadAndVerifyImportMap(
  bundleUrl: string,
): Promise<{ map: BundleImportMap | null; ok: boolean; reason?: string }> {
  // import-map.json sits next to theme.js; replace the last segment.
  const mapUrl = new URL(bundleUrl);
  mapUrl.pathname = mapUrl.pathname.replace(/[^/]+$/, "import-map.json");
  let bundleMap: BundleImportMap | null;
  try {
    const res = await fetch(mapUrl.toString(), {
      cache: BUNDLE_CACHE,
      signal: AbortSignal.timeout(THEME_META_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Older bundles built before plugin 0.2.0 don't ship one. Treat
      // as self-contained — skip the check rather than refuse to load.
      return { map: null, ok: true };
    }
    bundleMap = (await res.json()) as BundleImportMap;
  } catch {
    return { map: null, ok: true };
  }

  if (!bundleMap.federate) return { map: bundleMap, ok: true };

  // Federated bundle — verify against host's runtime manifest.
  let hostManifest: HostRuntimeManifest;
  try {
    const res = await fetch("/__numu-runtime/manifest.json", {
      cache: BUNDLE_CACHE,
      signal: AbortSignal.timeout(THEME_META_TIMEOUT_MS),
    });
    if (!res.ok) {
      return {
        map: bundleMap,
        ok: false,
        reason:
          "Bundle was built with federate=true but the host runtime " +
          "manifest is missing. Run `npm run build:runtime` on the storefront.",
      };
    }
    hostManifest = (await res.json()) as HostRuntimeManifest;
  } catch (err) {
    return {
      map: bundleMap,
      ok: false,
      reason: `Failed to fetch host runtime manifest: ${(err as Error).message}`,
    };
  }

  const versionParts = hostManifest.sdk_version.split(".");
  const hostMajor = parseInt(versionParts[0] ?? "0", 10);
  const hostMinor = parseInt(versionParts[1] ?? "0", 10);
  if (
    Number.isFinite(hostMajor) &&
    bundleMap.sdk_compat_major !== hostMajor
  ) {
    return {
      map: bundleMap,
      ok: false,
      reason:
        `Bundle expects @numu/theme-sdk major ${bundleMap.sdk_compat_major}, ` +
        `host serves ${hostManifest.sdk_version}. Rebuild the theme against ` +
        `the current SDK before reactivating.`,
    };
  }

  // 0.x minor gate. Semver treats 0.x minors as breaking and the SDK is still
  // pre-1.0, so a bundle built against a NEWER minor than the host runtime
  // serves can call SDK APIs the host doesn't provide → runtime crash. Reject
  // with an actionable message instead. Guards:
  //   - only in the 0.x line (at >=1.0 the major check already covers breaks);
  //   - only when the bundle DECLARES a numeric sdk_compat_minor — older
  //     bundles omit it and must keep loading (skip the check);
  //   - only when that minor is strictly greater than the host's.
  if (
    hostMajor === 0 &&
    Number.isFinite(hostMinor) &&
    typeof bundleMap.sdk_compat_minor === "number" &&
    Number.isFinite(bundleMap.sdk_compat_minor) &&
    bundleMap.sdk_compat_minor > hostMinor
  ) {
    return {
      map: bundleMap,
      ok: false,
      reason:
        `Theme built against SDK 0.${bundleMap.sdk_compat_minor} but host ` +
        `runtime serves ${hostManifest.sdk_version}; rebuild/redeploy the host ` +
        `runtime (npm run build:runtime) before serving this theme.`,
    };
  }

  return { map: bundleMap, ok: true };
}

/**
 * Load an external BYOT theme bundle. Returns the whole module so the
 * caller can pick between two contracts:
 *   - `mod.mount(el, props) -> () => void` — preferred. The bundle owns
 *     the render cycle for its subtree using its own React, sidestepping
 *     the "two copies of React" hooks-dispatcher null crash.
 *   - `mod.default` — plain React component, rendered by the host's
 *     React. Only safe when the bundle externalizes React and the host
 *     supplies it via an import map (federate=true).
 *
 * Rejects if the URL is not on the allowlist or if the optional
 * checksum doesn't match.
 */
// Module memo, keyed by bundle URL. Versioned bundle URLs
// (`/<slug>/<version>/theme.js`) are IMMUTABLE — the same URL always yields the
// same module — so we cache the load promise and replay it on every subsequent
// mount. Without this, each client navigation re-runs the full
// fetch → verify → (checksum path) re-evaluate-the-whole-bundle cycle: the
// checksum branch imports a FRESH blob URL each time, which the browser never
// module-caches, so a ~480KB theme bundle re-evaluates on every page change.
// A new theme version ships a new URL → cache miss → fresh load, so this never
// serves a stale bundle. Failed loads are evicted so a retry can re-attempt.
const _themeModuleCache = new Map<string, Promise<unknown>>();

export function loadExternalTheme(
  bundleUrl: string,
  options: LoadOptions = {},
): Promise<unknown> {
  // Key on URL + checksum so a load is only replayed when the verification
  // contract is identical (a given bundleUrl always pairs with the same
  // checksum in practice; this just makes that explicit).
  const key = `${bundleUrl}::${options.expectedChecksum ?? ""}`;
  const cached = _themeModuleCache.get(key);
  if (cached) return cached;
  const p = _loadExternalThemeUncached(bundleUrl, options);
  _themeModuleCache.set(key, p);
  p.catch(() => _themeModuleCache.delete(key));
  return p;
}

/**
 * Self-heal the federation import map before evaluating a federate:true
 * bundle. On `notFound()` responses Next does NOT emit the layout <head>
 * into the initial HTML — the `<script type="importmap">` only reaches the
 * client inside React Flight data, and React inserts script tags WITHOUT
 * executing them, so the browser never registers the map and the bundle's
 * bare imports (`react/jsx-runtime`, `@numueg/theme-sdk`, …) throw
 * "Failed to resolve module specifier". (This regressed the themed-404
 * backstop for every federated theme.)
 *
 * Probe: actually import `react/jsx-runtime` — if a parser-registered map
 * exists this resolves instantly from cache. If it throws, rebuild the map
 * from the public runtime manifest and insert it imperatively; Chrome 133+
 * registers dynamically-inserted import maps. One-shot per document.
 */
let _importMapEnsure: Promise<void> | null = null;
function ensureRuntimeImportMap(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  if (_importMapEnsure) return _importMapEnsure;
  _importMapEnsure = (async () => {
    try {
      await dynamicImport("react/jsx-runtime");
      return; // a live import map already resolves the runtime
    } catch {
      /* unresolvable → the map never registered on this document */
    }
    try {
      const res = await fetch("/__numu-runtime/manifest.json", { cache: "force-cache" });
      if (!res.ok) return;
      const manifest = (await res.json()) as { files?: Record<string, string> };
      const files = manifest.files ?? {};
      const urlFor = (f: string) =>
        `/__numu-runtime/${f}${files[f] ? `?v=${files[f]}` : ""}`;
      const map = {
        imports: {
          react: urlFor("react.js"),
          "react/jsx-runtime": urlFor("react-jsx-runtime.js"),
          "react/jsx-dev-runtime": urlFor("react-jsx-dev-runtime.js"),
          "react-dom": urlFor("react-dom.js"),
          "react-dom/client": urlFor("react-dom-client.js"),
          "@numueg/theme-sdk": urlFor("sdk.js"),
          "@numu/theme-sdk": urlFor("sdk.js"),
        },
      };
      const s = document.createElement("script");
      s.type = "importmap";
      s.setAttribute("data-numu-live", "1");
      s.textContent = JSON.stringify(map);
      document.head.appendChild(s);
    } catch (err) {
      console.warn("[external-loader] import-map self-heal failed", err);
    }
  })();
  return _importMapEnsure;
}

async function _loadExternalThemeUncached(
  bundleUrl: string,
  options: LoadOptions = {},
): Promise<unknown> {
  if (!isAllowedBundleUrl(bundleUrl)) {
    throw new Error(`Refusing to load bundle from disallowed host: ${bundleUrl}`);
  }

  // Federated bundles need the runtime import map registered on THIS
  // document before evaluation (see ensureRuntimeImportMap docstring).
  await ensureRuntimeImportMap();

  // Federation compat check: a bundle built against an incompatible
  // SDK major would crash on first hook call with a confusing error.
  // Catch it here with a clear message instead. Self-contained bundles
  // (or older ones with no import-map.json) skip the check.
  const verify = await loadAndVerifyImportMap(bundleUrl);
  if (!verify.ok) {
    throw new Error(verify.reason ?? "Bundle compatibility check failed");
  }

  // If we have a checksum, fetch the bundle bytes first, verify, then
  // create a blob URL we can dynamically import. This keeps untrusted JS
  // from running before verification.
  if (options.expectedChecksum && isChecksumEnforced()) {
    const res = await fetch(bundleUrl, { cache: BUNDLE_CACHE });
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
      return await dynamicImport(blobUrl);
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  // No checksum: still apply the allowlist gate above, then import directly.
  return await dynamicImport(bundleUrl);
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
