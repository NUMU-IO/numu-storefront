/**
 * Server component: emit the BYOT runtime <script type="importmap">.
 *
 * Theme bundles built with `numuTheme({ federate: true })` import bare
 * specifiers (`react`, `react/jsx-runtime`, `@numu/theme-sdk`, …). The
 * browser resolves those at module-load time using whichever import map
 * was parsed during the document's HTML parsing phase. A page that
 * lacks one will throw "Failed to resolve module specifier 'react'"
 * the moment ByotThemeBoundary's dynamic import runs.
 *
 * The import map MUST be:
 *   - emitted as a literal `<script type="importmap">` element
 *   - present in the initial HTML the browser parses (not added later
 *     by client JS — the spec ignores import maps inserted after the
 *     first module fetch)
 *
 * Cache-busting: scripts/build-runtime.mjs writes manifest.json with
 * a SHA-256 short hash per output file. We stamp `?v=<hash>` on each
 * URL so a runtime rebuild invalidates browser caches — but identical
 * builds keep the same URL and cache forever.
 *
 * If the manifest doesn't exist yet (first-run dev / before
 * `npm run build:runtime`), this component returns null. Themes built
 * with `federate: false` still work; older bundles or self-contained
 * builds don't depend on the import map.
 */

import * as fs from "node:fs";
import * as path from "node:path";

interface RuntimeManifest {
  built_at: string;
  sdk_version: string;
  react_version: string;
  react_dom_version: string;
  files: Record<string, string>;
}

const RUNTIME_DIR = path.join(
  process.cwd(),
  "public",
  "__numu-runtime",
);

function readManifest(): RuntimeManifest | null {
  const p = path.join(RUNTIME_DIR, "manifest.json");
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8")) as RuntimeManifest;
  } catch {
    return null;
  }
}

/**
 * Build the import-map URL for a runtime entry, including its hash
 * for cache busting. Falls back to no-hash if the file isn't in the
 * manifest (transient state during dev).
 */
function urlFor(manifest: RuntimeManifest, file: string): string {
  const hash = manifest.files[file];
  const base = `/__numu-runtime/${file}`;
  return hash ? `${base}?v=${hash}` : base;
}

export function RuntimeImportMap() {
  const manifest = readManifest();
  if (!manifest) return null;

  const map = {
    imports: {
      "react": urlFor(manifest, "react.js"),
      "react/jsx-runtime": urlFor(manifest, "react-jsx-runtime.js"),
      "react/jsx-dev-runtime": urlFor(manifest, "react-jsx-dev-runtime.js"),
      "react-dom": urlFor(manifest, "react-dom.js"),
      "react-dom/client": urlFor(manifest, "react-dom-client.js"),
      "@numu/theme-sdk": urlFor(manifest, "sdk.js"),
    },
  };

  // Stable JSON formatting so SSR/CSR hydration matches.
  const json = JSON.stringify(map);

  return (
    <script
      type="importmap"
      // The import map's content is data we control (paths from the
      // server's own filesystem manifest). dangerouslySetInnerHTML is
      // necessary because Next escapes `</script>` inside text-children
      // for <script> elements with `type` other than "module" — the
      // spec requires importmap to be inline JSON.
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}

/**
 * Resolve the runtime version stamp, useful for the install/upgrade
 * compatibility check (FastAPI persists this as `host_runtime_version`
 * on theme_versions and refuses bundles built against an incompatible
 * SDK major).
 */
export function getRuntimeVersionInfo(): {
  sdk: string;
  react: string;
} | null {
  const manifest = readManifest();
  if (!manifest) return null;
  return {
    sdk: manifest.sdk_version,
    react: manifest.react_version,
  };
}
