/**
 * Bundle the BYOT runtime: React, ReactDOM, react/jsx-runtime, and the
 * @numu/theme-sdk into ESM modules served from /public/__numu-runtime/.
 *
 * Why this exists:
 *   Theme bundles built with `numuTheme({ federate: true })` import
 *   `react`, `react/jsx-runtime`, `react-dom/client`, `@numu/theme-sdk`
 *   as bare specifiers. Browsers can't resolve bare specifiers — they
 *   need an import map. layout.tsx ships that import map; this script
 *   produces the files the import map points at.
 *
 *   The win: every BYOT theme drops from ~350 KB → ~30 KB, and shares
 *   one cached copy of React across all themes a customer ever loads.
 *   It also unifies React identity across host + bundle, so context
 *   plumbing across the seam works without singleton-shim gymnastics.
 *
 * How it works:
 *   esbuild's `splitting: true` with multiple entry points pulls each
 *   bare-specifier root into its own output file AND extracts shared
 *   internals (e.g. react-internal) into a chunks/* file that all
 *   entries import from. The shared chunk is the magic — React's
 *   "two copies" trap is avoided because every consumer ends up
 *   importing from the SAME chunk URL.
 *
 *   Cache busting: each build records its hash in manifest.json. The
 *   layout reads it at request time and stamps it as a query param on
 *   import-map URLs (?v=<hash>). Browsers cache aggressively while
 *   reliably picking up new builds.
 *
 * Where to call this:
 *   `npm run build` runs `prebuild` automatically (configured in
 *   package.json). Local dev calls `npm run build:runtime` once to
 *   populate /public/__numu-runtime; we wire HMR for it later.
 */

import { build } from "esbuild";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const OUT_DIR = path.join(REPO_ROOT, "public", "__numu-runtime");
const SDK_ROOT = path.resolve(REPO_ROOT, "..", "numu-theme-sdk");
const SDK_DIST = path.join(SDK_ROOT, "dist", "index.mjs");

function resolveFromStorefront(specifier) {
  // `paths: [REPO_ROOT]` so we hit numu-storefront/node_modules even
  // when this script runs from a workspace root.
  return require.resolve(specifier, { paths: [REPO_ROOT] });
}

function pkgVersion(pkgDir) {
  return JSON.parse(
    fs.readFileSync(path.join(pkgDir, "package.json"), "utf-8"),
  ).version;
}

function rmrfSafe(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

function ensureSdkBuilt() {
  if (!fs.existsSync(SDK_DIST)) {
    throw new Error(
      `[build-runtime] @numu/theme-sdk dist not found at ${SDK_DIST}. ` +
        `Run \`npm --prefix ../numu-theme-sdk run build\` first.`,
    );
  }
}

async function main() {
  ensureSdkBuilt();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  rmrfSafe(OUT_DIR);

  // Wrapper entries: importing React's CJS through `import { useMemo }
  // from "react"` only works if the bundled `react.js` actually exports
  // `useMemo` as a NAMED export. esbuild's CJS-to-ESM converter doesn't
  // statically detect React's exports (they live behind a wrapping
  // `module.exports = require(... production.min.js)`), so a bare
  // `entryPoint: "react"` produces a bundle with only a default export
  // — and theme bundles using named imports throw "does not provide an
  // export named 'useMemo'" at load time.
  //
  // Fix: generate tiny wrapper files that re-export the namespace
  // explicitly. esbuild bundles the wrappers; the wrappers handle the
  // namespace-to-named-export bridge. We enumerate React's exports
  // because `export *` from a CJS-resolved module also misses them.
  const WRAPPER_DIR = path.join(OUT_DIR, "..", "__numu-runtime-src");
  fs.mkdirSync(WRAPPER_DIR, { recursive: true });

  // React 19 surface — covers everything theme bundles import in
  // practice. Add to this list (not `export *`) if a theme errors on
  // a missing named export.
  //
  // CRITICAL: include the `__CLIENT_INTERNALS_*` symbol. react-dom
  // imports it to find the current dispatcher (which is what hooks
  // dereference for state slots). Without it, every hook call from
  // react-dom hits a null dispatcher and dies with
  // "Cannot read properties of null (reading 'useState')". Same for
  // `__SERVER_INTERNALS_*` (used by streaming SSR; harmless to include
  // even when only client-side React is loaded).
  const REACT_EXPORTS = [
    "Children",
    "Component",
    "Fragment",
    "Profiler",
    "PureComponent",
    "StrictMode",
    "Suspense",
    "cloneElement",
    "createContext",
    "createElement",
    "createRef",
    "forwardRef",
    "isValidElement",
    "lazy",
    "memo",
    "startTransition",
    "use",
    "useActionState",
    "useCallback",
    "useContext",
    "useDebugValue",
    "useDeferredValue",
    "useEffect",
    "useId",
    "useImperativeHandle",
    "useInsertionEffect",
    "useLayoutEffect",
    "useMemo",
    "useOptimistic",
    "useReducer",
    "useRef",
    "useState",
    "useSyncExternalStore",
    "useTransition",
    "version",
    "__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE",
    "__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE",
  ];

  // React-dom's internal namespace symbol is `__DOM_INTERNALS_*` —
  // include for the same reason as React's `__CLIENT_INTERNALS_*`.
  const REACT_DOM_EXPORTS = [
    "createPortal",
    "flushSync",
    "preconnect",
    "prefetchDNS",
    "preinit",
    "preinitModule",
    "preload",
    "preloadModule",
    "version",
    "__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE",
  ];

  const REACT_DOM_CLIENT_EXPORTS = [
    "createRoot",
    "hydrateRoot",
    "version",
  ];

  function writeNamespaceWrapper(
    file,
    sourceModule,
    namedExports,
  ) {
    const lines = [
      `import * as ns from ${JSON.stringify(sourceModule)};`,
      `export default ns;`,
    ];
    for (const name of namedExports) {
      lines.push(`export const ${name} = ns.${name};`);
    }
    fs.writeFileSync(path.join(WRAPPER_DIR, file), lines.join("\n") + "\n");
  }

  writeNamespaceWrapper("react.mjs", "react", REACT_EXPORTS);
  writeNamespaceWrapper("react-dom.mjs", "react-dom", REACT_DOM_EXPORTS);
  writeNamespaceWrapper(
    "react-dom-client.mjs",
    "react-dom/client",
    REACT_DOM_CLIENT_EXPORTS,
  );

  // jsx-runtime / jsx-dev-runtime are smaller; their named exports are
  // jsx, jsxs (+ jsxDEV in dev). Same wrapper pattern.
  writeNamespaceWrapper(
    "react-jsx-runtime.mjs",
    "react/jsx-runtime",
    ["jsx", "jsxs", "Fragment"],
  );
  writeNamespaceWrapper(
    "react-jsx-dev-runtime.mjs",
    "react/jsx-dev-runtime",
    ["jsxDEV", "Fragment"],
  );

  // Split into two builds, each with the right `external` policy:
  //
  //   1. React/ReactDOM/jsx-runtime wrappers bundle their npm packages
  //      in (so the runtime is self-contained — the browser doesn't
  //      need a recursive import-map entry for React's internals).
  //
  //   2. The SDK build keeps `react`, `react-dom`, `react-dom/client`,
  //      `react/jsx-runtime`, `react/jsx-dev-runtime` external. Without
  //      this, esbuild inlines a SECOND copy of React inside sdk.js
  //      (the SDK's own `import { useState } from "react"` resolves to
  //      the npm package and gets bundled). Two React copies = the
  //      classic "Cannot read properties of null (reading 'useState')"
  //      dispatcher mismatch. With external on, sdk.js emits literal
  //      `import { useState } from "react"` and the browser's import
  //      map routes it back to the wrapper's react.js at load time.
  //
  // We use a single `outdir` so chunk filenames cohabit and there's
  // one set of cache-busting hashes.
  const reactEntries = [
    { in: path.join(WRAPPER_DIR, "react.mjs"), out: "react" },
    {
      in: path.join(WRAPPER_DIR, "react-jsx-runtime.mjs"),
      out: "react-jsx-runtime",
    },
    {
      in: path.join(WRAPPER_DIR, "react-jsx-dev-runtime.mjs"),
      out: "react-jsx-dev-runtime",
    },
    { in: path.join(WRAPPER_DIR, "react-dom.mjs"), out: "react-dom" },
    {
      in: path.join(WRAPPER_DIR, "react-dom-client.mjs"),
      out: "react-dom-client",
    },
  ];

  const sharedBuildOpts = {
    bundle: true,
    format: "esm",
    splitting: true,
    outdir: OUT_DIR,
    platform: "browser",
    target: "es2022",
    minify: true,
    treeShaking: true,
    legalComments: "none",
    metafile: true,
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  };

  const reactResult = await build({
    ...sharedBuildOpts,
    entryPoints: reactEntries,
  });

  const sdkResult = await build({
    ...sharedBuildOpts,
    entryPoints: [{ in: SDK_DIST, out: "sdk" }],
    // Mark every React surface external. Browser's import map resolves
    // these to the wrapper files emitted by the build above. This is
    // what guarantees a SINGLE React identity across the host runtime
    // and the SDK.
    external: [
      "react",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom",
      "react-dom/client",
    ],
  });

  // Merge metafiles so the manifest covers both builds.
  const result = {
    metafile: {
      outputs: {
        ...reactResult.metafile.outputs,
        ...sdkResult.metafile.outputs,
      },
    },
  };

  // ── Build manifest ────────────────────────────────────────────────────
  // Hash all output files so layout.tsx can stamp `?v=<hash>` on each
  // import-map URL for cache busting.
  const fileHashes = {};
  function hashFile(p) {
    const bytes = fs.readFileSync(p);
    return crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  }
  for (const outRel of Object.keys(result.metafile.outputs)) {
    const abs = path.resolve(REPO_ROOT, outRel);
    const rel = path.relative(OUT_DIR, abs).replace(/\\/g, "/");
    fileHashes[rel] = hashFile(abs);
  }

  const manifest = {
    built_at: new Date().toISOString(),
    sdk_version: pkgVersion(SDK_ROOT),
    react_version: pkgVersion(
      path.dirname(resolveFromStorefront("react/package.json")),
    ),
    react_dom_version: pkgVersion(
      path.dirname(resolveFromStorefront("react-dom/package.json")),
    ),
    files: fileHashes,
  };
  fs.writeFileSync(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  console.log(
    `[build-runtime] emitted ${Object.keys(fileHashes).length} files to ${OUT_DIR}`,
  );
  console.log(
    `[build-runtime] react=${manifest.react_version} sdk=${manifest.sdk_version}`,
  );
}

main().catch((err) => {
  console.error("[build-runtime] failed:", err);
  process.exit(1);
});
