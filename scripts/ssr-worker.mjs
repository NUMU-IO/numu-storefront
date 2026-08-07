/**
 * Isolated theme SSR worker (ADR-7 follow-up — the opt-in capability the
 * content-layer decision left open).
 *
 * Runs as a CHILD PROCESS of the Next server — theme code never executes in
 * the main Node process. The parent (src/lib/ssr-theme.ts) enforces the rest
 * of the isolation posture:
 *   - spawned with a scrubbed env (no secrets to read),
 *   - Node permission model when available (fs read-only allowlist, no
 *     network, no child processes),
 *   - heap cap + per-request timeout + kill/respawn,
 *   - the parent does ALL network fetching — this process only reads the
 *     already-written bundle file from disk.
 *
 * Protocol (process IPC):
 *   → {id, op: "ping"}
 *   ← {id, ok: true, pong: true, isolation: "permission" | "none"}
 *   → {id, op: "render", bundlePath, ctx}
 *   ← {id, ok: true, html} | {id, ok: false, error}
 *
 * The bundle is the plugin's `theme.server.js` (same entry as the client
 * bundle, built in SSR mode). Its bare imports (react, react-dom,
 * @numueg/theme-sdk) resolve through the `.numu-ssr/node_modules` junctions
 * the parent creates, so the SDK here is the same build the federated
 * runtime serves and there is exactly ONE React instance in this process.
 *
 * Failure philosophy: anything a theme does wrong (window at module scope,
 * throw during render, missing createApp) is caught and reported — the
 * parent falls back to today's client-only mount. A worker crash costs one
 * respawn, never a page.
 */

import { pathToFileURL } from "node:url";
import { renderToString } from "react-dom/server";

// Mirror the flag the browser gets inlined by RuntimeImportMap. The SDK's
// `focalSrc` reads it off globalThis to decide whether an image URL carries
// crop params (`fp-x`/`fp-y`/`ar`/`fit`) — `/api/image-transform` only honors
// those under Cloudflare Image Resizing, and emitting them otherwise just
// builds a URL that misses the hero's <link rel=preload>. Setting it here
// keeps the server-rendered `src` byte-identical to the client's.
globalThis.__NUMU_CF_IMAGE_RESIZING__ =
  process.env.NUMU_CF_IMAGE_RESIZING === "1";

const MODULE_CACHE_MAX = 8;
/** bundlePath -> module namespace (insertion-ordered for LRU eviction). */
const modules = new Map();

async function loadEntry(bundlePath) {
  if (modules.has(bundlePath)) {
    const mod = modules.get(bundlePath);
    // refresh LRU position
    modules.delete(bundlePath);
    modules.set(bundlePath, mod);
    return mod;
  }
  const mod = await import(pathToFileURL(bundlePath).href);
  modules.set(bundlePath, mod);
  if (modules.size > MODULE_CACHE_MAX) {
    // Evict the oldest entry. The imported module itself stays in Node's
    // internal registry (ESM can't be unloaded) — this cap only bounds our
    // own map; the parent recycles the whole process on memory pressure.
    const oldest = modules.keys().next().value;
    modules.delete(oldest);
  }
  return mod;
}

function reply(msg) {
  if (process.send) process.send(msg);
}

process.on("message", async (msg) => {
  if (!msg || typeof msg !== "object") return;
  const { id, op } = msg;
  if (op === "ping") {
    reply({
      id,
      ok: true,
      pong: true,
      isolation: process.permission ? "permission" : "none",
    });
    return;
  }
  if (op !== "render") return;
  try {
    const mod = await loadEntry(msg.bundlePath);
    const createApp = mod.createApp ?? mod.default?.createApp;
    if (typeof createApp !== "function") {
      throw new Error("bundle exports no createApp(ctx)");
    }
    const html = renderToString(createApp(msg.ctx));
    reply({ id, ok: true, html });
  } catch (err) {
    reply({
      id,
      ok: false,
      error: String((err && err.message) || err).slice(0, 500),
    });
  }
});

// Exit with the parent: the IPC channel closing means the Next server went
// away (or killed us deliberately) — never linger as an orphan.
process.on("disconnect", () => process.exit(0));
