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
      // The published SDK package is `@numueg/theme-sdk` — that's the bare
      // specifier federate:true bundles import (the plugin externalizes it,
      // see numu-theme-plugin src/index.ts). The map previously only keyed
      // `@numu/theme-sdk` (missing "eg"), so federated bundles would throw
      // "Failed to resolve module specifier @numueg/theme-sdk" (Session G
      // finding F2). Publish BOTH keys → same module, so either specifier
      // resolves and no bundle breaks regardless of which it imports.
      "@numueg/theme-sdk": urlFor(manifest, "sdk.js"),
      "@numu/theme-sdk": urlFor(manifest, "sdk.js"),
    },
  };

  // Stable JSON formatting so SSR/CSR hydration matches.
  const json = JSON.stringify(map);

  // Modules the federated bundle actually pulls, in the order it pulls them.
  // `react-dom.js` and `react-jsx-dev-runtime.js` are deliberately absent —
  // they're in the map (so a bundle CAN import them) but no production bundle
  // does, and warming them would be pure waste.
  //
  // A warm URL MUST be byte-identical to the one the module graph resolves,
  // because the module map is keyed by URL: warm it under a different spelling
  // and the browser instantiates the file TWICE, as two unrelated modules.
  // The entry points are reached through the import map above, so they carry
  // `?v=<hash>`. The shared chunks are NOT — they're reached by relative
  // specifier from inside those entries (`import … from "./chunk-EK7ODJWE.js"`),
  // so they must be warmed bare. Stamping them cost a second copy of React's
  // internals, and a theme that mounted against the wrong one rendered nothing
  // at all, silently, with no console error.
  //
  // Dropping the query is safe: chunk names are content-hashed by the bundler
  // (`chunk-EK7ODJWE.js`), so a rebuild changes the NAME, not just a query.
  const entryFiles = [
    "react.js",
    "react-jsx-runtime.js",
    "react-dom-client.js",
    "sdk.js",
  ].filter((f) => f in manifest.files);
  const chunkFiles = Object.keys(manifest.files).filter((f) =>
    f.startsWith("chunk-"),
  );
  const warmUrls = [
    ...entryFiles.map((f) => urlFor(manifest, f)),
    ...chunkFiles.map((f) => `/__numu-runtime/${f}`),
  ];

  // Handed to the client so the SDK's `focalSrc` emits crop params only when
  // `/api/image-transform` will actually honor them. Same env var the resolver
  // reads (src/lib/image-transform.ts) — the URL a theme builds and the
  // transform the server performs stay in lockstep from one source of truth.
  const cfImageResizing = process.env.NUMU_CF_IMAGE_RESIZING === "1";

  const boot = [
    // The compat gate in external-loader.ts used to fetch this over the
    // network before it could evaluate the bundle. We just read it off disk to
    // build the map above, so handing it over inline deletes a round trip from
    // the critical path — and it's FRESHER than the fetch was: that file is an
    // unversioned, mutable pointer served with `immutable`, which is exactly
    // why the loader had to send `cache: "no-cache"` and eat a revalidation.
    `w.__NUMU_RUNTIME_MANIFEST__=${JSON.stringify({
      sdk_version: manifest.sdk_version,
      react_version: manifest.react_version,
    })};`,
    `w.__NUMU_CF_IMAGE_RESIZING__=${cfImageResizing};`,
    // Warm the runtime module graph NOW instead of at first import.
    //
    // These files were discovered one hop at a time — the bundle imports
    // `@numueg/theme-sdk`, which pulls `react`, which pulls a chunk — so on
    // vionne's mobile run they cost four serial round trips (7.46 s → 9.02 s)
    // before a single pixel of the theme could render.
    //
    // They are injected by SCRIPT, not written as JSX <link> elements, and
    // that is load-bearing. React hoists <link> resources ABOVE inline scripts
    // in the streamed <head> regardless of JSX order, so a JSX modulepreload
    // would be parsed BEFORE the import map above it, resolve the runtime's
    // own bare specifiers with no map in effect, and make the browser discard
    // the late map — every federated theme then dies on "Failed to resolve
    // module specifier". (Same trap the theme-bundle preload in layout.tsx
    // documents, which is why THAT one is `rel=preload as=script`.) An inline
    // script can't be hoisted past the map, so by the time this runs the map
    // is registered and `modulepreload` is safe — and unlike `as=script` it
    // warms the transitive graph, which is the whole point.
    `${JSON.stringify(warmUrls)}.forEach(function(h){`,
    `var l=d.createElement("link");l.rel="modulepreload";l.href=h;d.head.appendChild(l);});`,
  ].join("");

  return (
    <>
      <script
        type="importmap"
        // The import map's content is data we control (paths from the
        // server's own filesystem manifest). dangerouslySetInnerHTML is
        // necessary because Next escapes `</script>` inside text-children
        // for <script> elements with `type` other than "module" — the
        // spec requires importmap to be inline JSON.
        dangerouslySetInnerHTML={{ __html: json }}
      />
      <script
        // MUST stay after the import map (see `boot`). Content is built from
        // the server's own manifest and a boolean — no user input reaches it.
        dangerouslySetInnerHTML={{
          __html: `(function(w,d){${boot}})(window,document);`,
        }}
      />
    </>
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
