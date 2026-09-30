/**
 * Self-check for the inline bootstraps in <MetaPixel> and <TikTokPixel>.
 *
 * Both components build their base snippet by string concatenation. A
 * mistake there fails silently in the browser: the inline script throws at
 * parse time and every store sends Meta and TikTok nothing. Same approach as
 * check-seo-emission.mjs: bundled with the esbuild that already ships in
 * devDependencies and run under `node:assert`.
 *
 *   node scripts/check-pixel-snippets.mjs
 *
 * For both load strategies it checks that each snippet parses, that a top
 * frame installs and queues the pixel, and that a framed page (a merchant
 * preview in the hub) installs nothing.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { build } from "esbuild";

const dir = mkdtempSync(join(tmpdir(), "numu-pixel-check-"));
// CommonJS, because react-dom/server requires Node built-ins at load time.
const outfile = join(dir, "pixels.cjs");

try {
  await build({
    stdin: {
      contents: `
        import { createElement } from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        import { MetaPixel } from "@/components/tracking/MetaPixel";
        import { TikTokPixel } from "@/components/tracking/TikTokPixel";
        export function snippets(loadStrategy) {
          globalThis.__snippets = [];
          renderToStaticMarkup(createElement(MetaPixel, { pixelIds: ["1"], loadStrategy }));
          renderToStaticMarkup(createElement(TikTokPixel, { pixelIds: ["T1"], loadStrategy }));
          return globalThis.__snippets;
        }`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    format: "cjs",
    platform: "node",
    jsx: "automatic",
    outfile,
    logLevel: "silent",
    // next/script only injects client-side, so stub it to capture the
    // snippet; usePathname needs the App Router context.
    plugins: [
      {
        name: "next-stubs",
        setup(b) {
          b.onResolve({ filter: /^next\/(script|navigation)$/ }, (a) => ({
            path: a.path,
            namespace: "stub",
          }));
          b.onLoad({ filter: /.*/, namespace: "stub" }, (a) => ({
            contents:
              a.path === "next/script"
                ? "export default function Script(p) { globalThis.__snippets.push(p.dangerouslySetInnerHTML.__html); return null; }"
                : "export const usePathname = () => '/';",
            loader: "js",
          }));
        },
      },
    ],
  });
  const { snippets } = createRequire(import.meta.url)(outfile);

  // Just enough of a browser for the snippets' synchronous part.
  const fakeWindow = () => {
    const doc = {
      cookie: "",
      addEventListener() {},
      createElement: () => ({}),
      getElementsByTagName: () => [{ parentNode: { insertBefore() {} } }],
    };
    const win = {
      document: doc,
      location: { hostname: "vionneeg.com", search: "", protocol: "https:", pathname: "/" },
      URLSearchParams,
      addEventListener() {},
    };
    win.self = win.window = win.top = win;
    return win;
  };

  for (const strategy of ["interaction", "immediate"]) {
    const [meta, tiktok] = snippets(strategy);

    const top = fakeWindow();
    vm.runInNewContext(meta, top);
    vm.runInNewContext(tiktok, top);
    assert.equal(typeof top.fbq, "function", `Meta stub installed (${strategy})`);
    assert.ok(top.fbq.queue.length >= 2, `Meta init + PageView queued (${strategy})`);
    assert.ok(top.ttq.length >= 1, `TikTok page() queued (${strategy})`);

    const framed = fakeWindow();
    framed.top = {};
    vm.runInNewContext(meta, framed);
    vm.runInNewContext(tiktok, framed);
    assert.equal(framed.fbq, undefined, `no Meta pixel inside a frame (${strategy})`);
    assert.equal(framed.ttq, undefined, `no TikTok pixel inside a frame (${strategy})`);
  }
  console.log("pixel snippets: ok");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
