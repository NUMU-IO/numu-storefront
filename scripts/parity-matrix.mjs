/**
 * Render-parity matrix — proof that a theme refactor changed nothing.
 *
 * Renders a theme's built `dist/theme.server.js` through the isolated SSR
 * worker across a fixed matrix of page types, locales and data fixtures, then
 * hashes the HTML. Run it BEFORE a refactor to capture a baseline and AFTER to
 * compare: any differing cell is a behaviour change, named precisely.
 *
 * This is the acceptance gate for migrating themes onto shared primitives
 * (Phase 4). "It still looks fine" is not evidence; a byte-identical hash over
 * a matrix is. The SSR worker makes it possible to get that evidence without a
 * browser, a store, or a database.
 *
 * Usage:
 *   node scripts/parity-matrix.mjs <theme-dir> --out baseline.json
 *   node scripts/parity-matrix.mjs <theme-dir> --compare baseline.json
 *
 * Determinism: the ctx below is fixed and contains no timestamps or random
 * values. A theme that renders `new Date()` will show as a diff — which is
 * itself worth knowing, since it also breaks hydration.
 */

import { fork } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const STOREFRONT = path.resolve(import.meta.dirname, "..");
const WORKER = path.join(STOREFRONT, "scripts", "ssr-worker.mjs");
const BUNDLES = path.join(STOREFRONT, ".numu-ssr", "bundles");

// ── fixtures ────────────────────────────────────────────────────────────────
// Three shapes on purpose: a populated store, an EMPTY store (the state that
// produces blank-page bugs), and a store with awkward data (missing slug,
// missing images, zero price) — the cases that historically broke.

const product = (i, over = {}) => ({
  id: `p${i}`,
  name: `Product ${i}`,
  slug: `product-${i}`,
  price: 1000 * i,
  compare_at_price: i % 2 ? 1500 * i : undefined,
  currency: "EGP",
  images: [{ url: `https://cdn.example/p${i}.jpg`, alt: `Product ${i}` }],
  variants: [{ id: `v${i}`, price: 1000 * i, sku: `SKU-${i}`, is_in_stock: true }],
  in_stock: true,
  ...over,
});

const collection = (i, over = {}) => ({
  id: `c${i}`,
  name: `Collection ${i}`,
  slug: `collection-${i}`,
  product_count: i,
  ...over,
});

const FIXTURES = {
  populated: {
    products: [product(1), product(2), product(3)],
    collections: [collection(1), collection(2)],
  },
  empty: { products: [], collections: [] },
  awkward: {
    products: [
      product(1, { slug: undefined, images: [], price: 0, compare_at_price: undefined }),
      product(2, { variants: [] }),
    ],
    collections: [collection(1, { slug: undefined })],
  },
};

const LOCALES = ["en", "ar"];

const PAGES = {
  home: (f) => ({ type: "home", title: "Parity Store", data: f }),
  collection: (f) => ({
    type: "collection",
    title: f.collections[0]?.name ?? "Collection",
    handle: "collection-1",
    data: { ...f, collection: f.collections[0] ? { ...f.collections[0], products: f.products } : undefined },
  }),
  product: (f) => ({
    type: "product",
    title: f.products[0]?.name ?? "Product",
    handle: "product-1",
    data: { ...f, product: f.products[0] },
  }),
  cart: (f) => ({ type: "cart", title: "Cart", data: f }),
  search: (f) => ({ type: "search", title: "Search", data: { ...f, query: "shirt" } }),
  "404": (f) => ({ type: "404", title: "Not found", data: f }),
};

const STORE = {
  id: "00000000-0000-0000-0000-0000000000p1",
  name: "Parity Store",
  slug: "parity",
  subdomain: "parity",
  currency: "EGP",
  default_language: "en",
  use_nextjs_storefront: true,
  social_links: { instagram: "https://instagram.com/parity" },
  settings: {},
};

/** Empty templates + empty section_groups → the theme falls back to its own
 *  bundled presets, which is exactly the path template resolution owns. */
const THEME_SETTINGS = {
  schema_version: 3,
  theme_id: "parity",
  global_settings: {},
  templates: {},
  section_groups: {},
};

// ── worker plumbing ─────────────────────────────────────────────────────────

function renderOnce(worker, bundlePath, ctx, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const id = Math.floor(Math.random() * 1e9);
    const timer = setTimeout(() => resolve({ ok: false, error: `timeout ${timeoutMs}ms` }), timeoutMs);
    const onMsg = (m) => {
      if (!m || m.id !== id) return;
      clearTimeout(timer);
      worker.off("message", onMsg);
      resolve(m);
    };
    worker.on("message", onMsg);
    worker.send({ id, op: "render", bundlePath, ctx });
  });
}

/**
 * Hash the HTML after normalising away things that legitimately vary between
 * runs but carry no meaning: React's internal comment markers and whitespace
 * between tags. Anything else differing is a real change.
 */
function normalisedHash(html) {
  const norm = String(html)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return crypto.createHash("sha256").update(norm).digest("hex").slice(0, 16);
}

async function main() {
  const [themeDir, ...rest] = process.argv.slice(2);
  if (!themeDir) {
    console.error("usage: parity-matrix.mjs <theme-dir> [--out f.json] [--compare f.json]");
    process.exit(2);
  }
  const outIdx = rest.indexOf("--out");
  const cmpIdx = rest.indexOf("--compare");
  const outFile = outIdx >= 0 ? rest[outIdx + 1] : null;
  const cmpFile = cmpIdx >= 0 ? rest[cmpIdx + 1] : null;

  const src = path.join(themeDir, "dist", "theme.server.js");
  if (!fs.existsSync(src)) {
    console.error(`no server bundle at ${src} — build the theme first`);
    process.exit(2);
  }
  const name = path.basename(themeDir);
  const dest = path.join(BUNDLES, `parity-${name}`);
  fs.mkdirSync(dest, { recursive: true });
  fs.copyFileSync(src, path.join(dest, "theme.server.js"));
  const bundlePath = path.join(dest, "theme.server.js");

  // Materialise the SDK the worker resolves against, from the current sibling
  // build, FRESH every run. The standalone harness (unlike the Next host) is
  // the only thing that sets this up, and it must be deterministic: baseline
  // and comparison have to render against byte-identical SDK bytes, or a diff
  // reflects the SDK, not the theme. We COPY dist (not link) so the SDK's own
  // `react` peer resolves upward to the host's single copy — a linked SDK
  // resolves its nested react and every hook dies with a null dispatcher.
  const nm = path.join(STOREFRONT, ".numu-ssr", "node_modules");
  const repoNm = path.join(STOREFRONT, "node_modules");
  const siblingSdk = path.resolve(STOREFRONT, "..", "numu-theme-sdk");
  const sdkSource = fs.existsSync(path.join(siblingSdk, "dist", "index.mjs"))
    ? siblingSdk
    : path.join(repoNm, "@numueg", "theme-sdk");
  fs.mkdirSync(path.join(nm, "@numueg"), { recursive: true });
  for (const dep of ["react", "react-dom"]) {
    const link = path.join(nm, dep);
    if (!fs.existsSync(link) && fs.existsSync(path.join(repoNm, dep))) {
      try {
        fs.symlinkSync(
          path.join(repoNm, dep),
          link,
          process.platform === "win32" ? "junction" : "dir",
        );
      } catch {
        /* best effort */
      }
    }
  }
  const sdkDest = path.join(nm, "@numueg", "theme-sdk");
  fs.rmSync(sdkDest, { recursive: true, force: true });
  fs.mkdirSync(sdkDest, { recursive: true });
  fs.cpSync(path.join(sdkSource, "dist"), path.join(sdkDest, "dist"), {
    recursive: true,
  });
  fs.copyFileSync(
    path.join(sdkSource, "package.json"),
    path.join(sdkDest, "package.json"),
  );

  const worker = fork(WORKER, [], {
    execArgv: ["--max-old-space-size=512"],
    env: { PATH: process.env.PATH, NODE_ENV: "production" },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });

  const cells = {};
  let failures = 0;
  for (const [fixtureName, fixture] of Object.entries(FIXTURES)) {
    for (const [pageName, buildPage] of Object.entries(PAGES)) {
      for (const locale of LOCALES) {
        const key = `${fixtureName}/${pageName}/${locale}`;
        const ctx = {
          themeSettings: THEME_SETTINGS,
          storeData: { ...STORE, default_language: locale },
          page: buildPage(fixture),
          locale,
          demo: false,
          navigation: {},
        };
        const res = await renderOnce(worker, bundlePath, ctx);
        if (!res.ok) {
          cells[key] = `ERROR: ${res.error}`;
          failures++;
        } else {
          cells[key] = `${normalisedHash(res.html)}:${res.html.length}`;
        }
      }
    }
  }
  worker.kill();

  const result = { theme: name, cellCount: Object.keys(cells).length, failures, cells };

  if (outFile) {
    fs.writeFileSync(outFile, JSON.stringify(result, null, 1));
    console.log(`baseline written: ${outFile}`);
  }

  if (cmpFile) {
    const base = JSON.parse(fs.readFileSync(cmpFile, "utf8"));
    const keys = new Set([...Object.keys(base.cells), ...Object.keys(cells)]);
    const diffs = [];
    for (const k of keys) {
      if (base.cells[k] !== cells[k]) diffs.push({ cell: k, before: base.cells[k], after: cells[k] });
    }
    console.log(`\n${name}: ${keys.size - diffs.length}/${keys.size} cells identical`);
    if (diffs.length) {
      console.log("DIFFERENCES:");
      for (const d of diffs.slice(0, 20)) {
        console.log(`  ${d.cell}\n    before ${d.before}\n    after  ${d.after}`);
      }
      process.exitCode = 1;
    } else {
      console.log("PARITY HELD — the refactor changed no rendered output.");
    }
  } else {
    console.log(`${name}: ${result.cellCount} cells, ${failures} render failures`);
    if (failures) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
