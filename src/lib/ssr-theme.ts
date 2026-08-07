/**
 * Isolated theme SSR — host side.
 *
 * ADR-7 decided the platform never server-renders theme code *in the main
 * Node process*, and explicitly left the door open for isolated SSR as an
 * opt-in per-theme capability. This is that door: theme bundles render in a
 * separate child process with no secrets, no DB, and a hard timeout, and the
 * result is injected as pre-hydration HTML.
 *
 * SHIPS DARK. `NUMU_SSR_THEME=1` enables it. With the flag off (default)
 * every function here short-circuits and the storefront behaves exactly as it
 * does today: skeleton → client mount. Nothing about this module is on the
 * request path until the flag flips.
 *
 * ── Why a child process and not `import()` in the server ────────────────────
 * Running third-party theme JS in the Next process would put it next to
 * `NUMU_API_URL`, `REVALIDATION_SECRET`, the fetch cache and every other
 * tenant's in-flight data. The child gets a scrubbed env, a read-only fs
 * allowlist under Node's permission model, no child-process/worker rights,
 * and a per-render deadline. Its worst outcome is a killed process and a
 * fallback to today's client mount — never a page, never a leak.
 *
 * Honest limit: Node's permission model does NOT gate outbound network. The
 * mitigations for that are the build-time AST scan (bundles that reach the
 * network are refused at publication) and the empty env (nothing worth
 * exfiltrating is reachable from inside). Do not read `--permission` as a
 * network sandbox.
 *
 * ── Parity, which is the thing that actually breaks ─────────────────────────
 * Server HTML and the client's first render must be the same React tree or
 * hydration tears the DOM down. Both come from ONE source: the theme's
 * `createApp(ctx)` (server, here) and `mountTheme(el, ctx)` (client) are both
 * produced by `defineThemeEntry`, so the tree is identical by construction —
 * PROVIDED the ctx matches. This module therefore builds the ctx from the
 * same inputs `ByotThemeBoundary` uses, and refuses to render when it cannot
 * (preview/demo requests are skipped entirely rather than guessed at).
 */

import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  RELATIVE_IMPORT,
  isAllowedBundleUrl,
  sha256Hex,
} from "./bundle-allowlist";

// ── configuration ───────────────────────────────────────────────────────────

/** Master switch. Off = this module is inert (see file header). */
export function isThemeSsrEnabled(): boolean {
  return process.env.NUMU_SSR_THEME === "1";
}

const RENDER_TIMEOUT_MS = numEnv("NUMU_SSR_TIMEOUT_MS", 400, 50, 5000);
const POOL_SIZE = numEnv("NUMU_SSR_POOL", 2, 1, 8);
const HEAP_MB = numEnv("NUMU_SSR_HEAP_MB", 256, 64, 2048);
/** Rendered HTML above this is dropped — a runaway theme must not bloat the
 *  document (and with it TTFB) for a crawler-facing nicety. */
const MAX_HTML_BYTES = numEnv("NUMU_SSR_MAX_HTML", 1_500_000, 10_000, 8_000_000);
const FETCH_TIMEOUT_MS = numEnv("NUMU_SSR_FETCH_TIMEOUT_MS", 4000, 500, 30_000);
/** Consecutive failures before a bundle is benched. */
const BREAKER_THRESHOLD = numEnv("NUMU_SSR_BREAKER", 3, 1, 50);
const BREAKER_COOLDOWN_MS = numEnv("NUMU_SSR_COOLDOWN_MS", 300_000, 1000, 3_600_000);

function numEnv(name: string, dflt: number, min: number, max: number): number {
  const raw = Number(process.env[name]);
  if (!Number.isFinite(raw)) return dflt;
  return Math.min(max, Math.max(min, Math.trunc(raw)));
}

const WORKSPACE = path.join(process.cwd(), ".numu-ssr");
const BUNDLE_DIR = path.join(WORKSPACE, "bundles");

function workerScriptPath(): string | null {
  const override = process.env.NUMU_SSR_WORKER_PATH;
  const candidates = [
    ...(override ? [override] : []),
    path.join(process.cwd(), "scripts", "ssr-worker.mjs"),
  ];
  return candidates.find((p) => safeExists(p)) ?? null;
}

function safeExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

// ── module resolution for the child ─────────────────────────────────────────

/**
 * The bundle imports `react`, `react-dom` and `@numueg/theme-sdk` as bare
 * specifiers (federated builds externalize them). Node resolves those by
 * walking up from the bundle's own directory, so the cached bundles live
 * under `.numu-ssr/bundles/**` with `.numu-ssr/node_modules` beside them,
 * pointing at the SAME builds the browser gets:
 *
 *   react / react-dom      → LINKED to the storefront's own copies, so the
 *                            child shares one physical React with the worker's
 *                            `react-dom/server` — one instance end to end.
 *   @numueg/theme-sdk      → COPIED (dist + package.json only), never linked.
 *                            Source precedence matches `build-runtime.mjs`
 *                            (sibling checkout wins), so server and client run
 *                            the same SDK build. See `materializeSdk` for why
 *                            linking it is fatal.
 */
let workspaceReady = false;
function ensureWorkspace(): boolean {
  if (workspaceReady) return true;
  try {
    fs.mkdirSync(BUNDLE_DIR, { recursive: true });
    const nm = path.join(WORKSPACE, "node_modules");
    fs.mkdirSync(path.join(nm, "@numueg"), { recursive: true });

    const repoNm = path.join(process.cwd(), "node_modules");

    // React + ReactDOM: link (not copy) so the child resolves the SAME
    // physical files the worker's own `react-dom/server` uses — one React
    // instance in the process, which is the whole ballgame for hooks.
    linkOnce(path.join(repoNm, "react"), path.join(nm, "react"));
    linkOnce(path.join(repoNm, "react-dom"), path.join(nm, "react-dom"));
    // `scheduler` is react-dom's own dependency, not one of ours, so nothing
    // links it — and react-dom sitting in `.numu-ssr/node_modules` cannot be
    // relied on to resolve it upward out of that directory. In the standalone
    // runner that surfaced as `Cannot find module 'scheduler'` on EVERY render,
    // right after the SDK failure, which tripped the circuit breaker and left
    // the whole feature inert (Suite 11, D11-2). Linking it costs nothing and
    // removes the dependency on resolution order.
    linkOnce(path.join(repoNm, "scheduler"), path.join(nm, "scheduler"));
    materializeSdk(nm, repoNm);

    // Keep the cache out of git and out of Next's file watcher.
    const ignore = path.join(WORKSPACE, ".gitignore");
    if (!safeExists(ignore)) fs.writeFileSync(ignore, "*\n", "utf8");

    workspaceReady = true;
    return true;
  } catch (err) {
    warn("ssr_workspace_failed", err);
    return false;
  }
}

/**
 * Put the SDK where the child can resolve it — by COPYING `dist/` +
 * `package.json`, never by linking the checkout.
 *
 * A link would leave the SDK sitting inside its own source tree, so its
 * `import "react"` resolves to that tree's NESTED `node_modules/react`
 * (19.2.7 in the sibling checkout) while the theme bundle and the worker's
 * `react-dom/server` resolve the host's (19.2.5). Two React instances mean a
 * null hook dispatcher and every render dies with
 * "Cannot read properties of null (reading 'useState')" — verified, not
 * theorised.
 *
 * Copying only the built output (no nested node_modules) makes the SDK's peer
 * deps resolve UPWARD to `.numu-ssr/node_modules/react` — precisely what a
 * published `npm install` produces. Source precedence matches
 * `build-runtime.mjs` (sibling checkout wins) so the server renders with the
 * same SDK build the browser is served.
 */
function materializeSdk(nm: string, repoNm: string): void {
  const sibling = path.resolve(process.cwd(), "..", "numu-theme-sdk");
  const source = safeExists(path.join(sibling, "dist", "index.mjs"))
    ? sibling
    : path.join(repoNm, "@numueg", "theme-sdk");
  if (!safeExists(path.join(source, "dist"))) return;

  const dest = path.join(nm, "@numueg", "theme-sdk");
  const srcVersion = readPkgVersion(source);
  if (readPkgVersion(dest) === srcVersion && safeExists(path.join(dest, "dist"))) {
    return; // already current
  }
  try {
    fs.rmSync(dest, { recursive: true, force: true });
    fs.mkdirSync(dest, { recursive: true });
    fs.cpSync(path.join(source, "dist"), path.join(dest, "dist"), {
      recursive: true,
    });
    fs.copyFileSync(
      path.join(source, "package.json"),
      path.join(dest, "package.json"),
    );
  } catch (err) {
    warn("ssr_sdk_materialize_failed", err);
  }
}

function readPkgVersion(dir: string): string | null {
  try {
    return (
      JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"))
        .version ?? null
    );
  } catch {
    return null;
  }
}

function linkOnce(target: string, link: string): void {
  if (safeExists(link) || !safeExists(target)) return;
  try {
    // "junction" is the only link type Windows grants without elevation;
    // it is ignored on POSIX, where "dir" is used.
    fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
  } catch {
    /* a missing link just means the child can't resolve that specifier and
       the render fails soft — never worth throwing on a dark path. */
  }
}

// ── bundle acquisition (the PARENT does all network I/O) ────────────────────

interface BundleRecord {
  /** Absolute path to the cached `theme.server.js`. */
  filePath: string;
}

const bundleCache = new Map<string, Promise<BundleRecord | null>>();

/** `…/theme.js` → `…/theme.server.js` / `…/manifest.json` (same directory). */
function siblingUrl(bundleUrl: string, name: string): string {
  const u = new URL(bundleUrl);
  u.pathname = u.pathname.replace(/[^/]*$/, name);
  u.search = "";
  return u.toString();
}

async function fetchWithTimeout(url: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      // The artifact is immutable per version+hash; let Next cache it.
      next: { revalidate: 3600 },
    });
    return res.ok ? res : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function acquireBundle(bundleUrl: string): Promise<BundleRecord | null> {
  const cached = bundleCache.get(bundleUrl);
  if (cached) return cached;

  const task = (async (): Promise<BundleRecord | null> => {
    // Gate 1 — provenance. Same allowlist the browser loader enforces.
    if (!isAllowedBundleUrl(bundleUrl)) return null;
    if (!ensureWorkspace()) return null;

    // Gate 2 — the theme must DECLARE server capability. The plugin writes
    // `ssr: {capable, server_bundle, server_bundle_checksum}` only when the
    // entry actually exports `createApp`; a theme that never opted in is
    // never server-rendered.
    const manifestRes = await fetchWithTimeout(siblingUrl(bundleUrl, "manifest.json"));
    if (!manifestRes) return null;
    let manifest: Record<string, unknown>;
    try {
      manifest = (await manifestRes.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
    const ssr = manifest.ssr as
      | { capable?: boolean; server_bundle?: string; server_bundle_checksum?: string }
      | undefined;
    if (!ssr?.capable || !ssr.server_bundle) return null;

    const serverRes = await fetchWithTimeout(siblingUrl(bundleUrl, ssr.server_bundle));
    if (!serverRes) return null;
    const bytes = new Uint8Array(await serverRes.arrayBuffer());

    // Gate 3 — integrity. Unlike the client path (whose enforcement is still
    // flagged off because a mismatch there blanks a live store), verification
    // here is ALWAYS on: the downside of refusing is losing a crawler-facing
    // nicety, so there is no reason to trust unverified bytes.
    const digest = await sha256Hex(bytes);
    if (ssr.server_bundle_checksum && ssr.server_bundle_checksum !== digest) {
      warn("ssr_bundle_checksum_mismatch", { bundleUrl });
      return null;
    }

    // Gate 4 — no code-split entries: a digest over a thin shim proves
    // nothing about the chunks it pulls in (see bundle-allowlist).
    const text = new TextDecoder().decode(bytes.subarray(0, 4096));
    if (RELATIVE_IMPORT.test(text)) {
      warn("ssr_bundle_code_split_refused", { bundleUrl });
      return null;
    }

    const dir = path.join(BUNDLE_DIR, digest.slice(0, 16));
    const filePath = path.join(dir, "theme.server.js");
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (!safeExists(filePath)) fs.writeFileSync(filePath, bytes);
    } catch (err) {
      warn("ssr_bundle_write_failed", err);
      return null;
    }
    return { filePath };
  })();

  bundleCache.set(bundleUrl, task);
  const result = await task;
  // Don't cache a negative forever — a theme may gain SSR on its next
  // publish, and a transient CDN failure shouldn't bench it for the process
  // lifetime.
  if (!result) setTimeout(() => bundleCache.delete(bundleUrl), 60_000).unref?.();
  return result;
}

// ── worker pool ─────────────────────────────────────────────────────────────

interface Worker {
  proc: ChildProcess;
  busy: boolean;
  /** Renders served by this process — recycled periodically so a slow leak
   *  in a theme can never accumulate. */
  served: number;
  pending: Map<number, { resolve: (v: unknown) => void; timer: NodeJS.Timeout }>;
}

const pool: Worker[] = [];
let msgSeq = 0;
const MAX_SERVED = 200;

function spawnWorker(): Worker | null {
  const script = workerScriptPath();
  if (!script) {
    warn("ssr_worker_script_missing", { cwd: process.cwd() });
    return null;
  }
  const execArgv = [`--max-old-space-size=${HEAP_MB}`];
  // Node's permission model (stable in 24) — read-only fs, and child
  // processes / worker threads / native addons denied by default. Enabled
  // opportunistically: on an older Node the flag would abort the fork, so we
  // only pass it when the running major supports it.
  if (supportsPermissionModel()) {
    execArgv.push(
      "--permission",
      `--allow-fs-read=${WORKSPACE}${path.sep}*`,
      `--allow-fs-read=${path.join(process.cwd(), "node_modules")}${path.sep}*`,
      `--allow-fs-read=${path.resolve(process.cwd(), "..", "numu-theme-sdk")}${path.sep}*`,
    );
  }
  let proc: ChildProcess;
  try {
    proc = fork(script, [], {
      execArgv,
      // Scrubbed env: the child gets what Node itself needs and nothing else.
      // No NUMU_API_URL, no REVALIDATION_SECRET, no DB credentials.
      //
      // NUMU_CF_IMAGE_RESIZING is a non-secret boolean and has to come along:
      // the SDK's `focalSrc` reads it to decide whether to put crop params on
      // an image URL. Without it the worker would render width-only `src`
      // values while the client (which gets the flag inlined by
      // RuntimeImportMap) rendered cropped ones — a hydration mismatch on
      // every image the moment CF resizing is switched on.
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "production",
        NUMU_CF_IMAGE_RESIZING: process.env.NUMU_CF_IMAGE_RESIZING ?? "",
      },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
  } catch (err) {
    warn("ssr_worker_spawn_failed", err);
    return null;
  }

  const worker: Worker = { proc, busy: false, served: 0, pending: new Map() };

  proc.on("message", (msg: unknown) => {
    const m = msg as { id?: number };
    if (!m || typeof m.id !== "number") return;
    const entry = worker.pending.get(m.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    worker.pending.delete(m.id);
    worker.busy = false;
    entry.resolve(msg);
  });

  const die = () => {
    for (const [, entry] of worker.pending) {
      clearTimeout(entry.timer);
      entry.resolve({ ok: false, error: "worker exited" });
    }
    worker.pending.clear();
    const i = pool.indexOf(worker);
    if (i >= 0) pool.splice(i, 1);
  };
  proc.on("exit", die);
  proc.on("error", die);
  proc.stderr?.on("data", (b: Buffer) =>
    warn("ssr_worker_stderr", String(b).slice(0, 300)),
  );
  proc.unref?.();

  pool.push(worker);
  return worker;
}

function supportsPermissionModel(): boolean {
  if (process.env.NUMU_SSR_NO_PERMISSION === "1") return false;
  // Windows is a DEV-ONLY environment here (prod runs Linux on EC2), and the
  // permission model's path allowlisting is unreliable with Windows path
  // separators + junctions — a failed fork there would look like "SSR is
  // broken" when the hardening simply couldn't apply. Skip it on win32 so
  // local verification exercises the real render path; every production host
  // gets the sandbox.
  if (process.platform === "win32") return false;
  const major = Number(process.versions.node.split(".")[0]);
  return Number.isFinite(major) && major >= 20;
}

function takeWorker(): Worker | null {
  const idle = pool.find((w) => !w.busy);
  if (idle) return idle;
  if (pool.length < POOL_SIZE) return spawnWorker();
  return null; // saturated — the caller falls back rather than queues
}

function retire(worker: Worker): void {
  try {
    worker.proc.kill();
  } catch {
    /* already gone */
  }
  const i = pool.indexOf(worker);
  if (i >= 0) pool.splice(i, 1);
}

function callWorker(
  worker: Worker,
  payload: Record<string, unknown>,
  timeoutMs: number,
): Promise<{ ok?: boolean; html?: string; error?: string }> {
  return new Promise((resolve) => {
    const id = ++msgSeq;
    const timer = setTimeout(() => {
      worker.pending.delete(id);
      // A theme that blows the deadline is not asked again politely — the
      // process is killed so an infinite loop can't hold a pool slot.
      retire(worker);
      resolve({ ok: false, error: `render timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    timer.unref?.();
    worker.pending.set(id, { resolve: resolve as (v: unknown) => void, timer });
    worker.busy = true;
    try {
      worker.proc.send({ id, ...payload });
    } catch (err) {
      clearTimeout(timer);
      worker.pending.delete(id);
      retire(worker);
      resolve({ ok: false, error: `send failed: ${String(err)}` });
    }
  });
}

// ── circuit breaker ─────────────────────────────────────────────────────────

const breaker = new Map<string, { fails: number; until: number }>();

function benched(key: string): boolean {
  const b = breaker.get(key);
  if (!b) return false;
  if (b.until && Date.now() < b.until) return true;
  if (b.until && Date.now() >= b.until) breaker.delete(key);
  return false;
}

function recordFailure(key: string, reason: string): void {
  const b = breaker.get(key) ?? { fails: 0, until: 0 };
  b.fails += 1;
  if (b.fails >= BREAKER_THRESHOLD) {
    b.until = Date.now() + BREAKER_COOLDOWN_MS;
    warn("ssr_bundle_benched", { key, reason, cooldownMs: BREAKER_COOLDOWN_MS });
  }
  breaker.set(key, b);
}

function recordSuccess(key: string): void {
  if (breaker.has(key)) breaker.delete(key);
}

// ── public API ──────────────────────────────────────────────────────────────

export interface ThemeSsrInput {
  bundleUrl: string | null | undefined;
  /** The SAME object the client boundary will pass — already dynamic-source
   *  resolved by the caller. Parity depends on this. */
  themeSettings: unknown;
  storeData: unknown;
  page: unknown;
  locale?: string;
  navigation?: unknown;
  /** Marketplace preview: never server-rendered (the client computes `demo`
   *  from the URL, so a server render would disagree and mismatch). */
  isPreview?: boolean;
}

/**
 * Render a theme's HTML for this request, or `null` to keep today's behavior.
 *
 * Every failure mode — flag off, theme not SSR-capable, bad provenance,
 * benched bundle, saturated pool, timeout, throw inside the theme — returns
 * `null`. The caller must treat `null` as "normal", not as an error.
 */
export async function renderThemeSsr(
  input: ThemeSsrInput,
): Promise<string | null> {
  if (!isThemeSsrEnabled()) return null;
  const { bundleUrl } = input;
  if (!bundleUrl || input.isPreview) return null;
  if (benched(bundleUrl)) return null;

  try {
    const bundle = await acquireBundle(bundleUrl);
    if (!bundle) {
      // Not capable / not allowed is a permanent-ish "no", not a fault:
      // record it so we stop re-fetching a manifest that says `capable:false`.
      recordFailure(bundleUrl, "unavailable");
      return null;
    }

    const worker = takeWorker();
    if (!worker) return null;

    const res = await callWorker(
      worker,
      {
        op: "render",
        bundlePath: bundle.filePath,
        // Mirrors ByotThemeBoundary's mount ctx exactly. `demo` is pinned
        // false because preview requests never reach here.
        ctx: {
          themeSettings: input.themeSettings,
          storeData: input.storeData,
          page: input.page,
          locale: input.locale,
          demo: false,
          navigation: input.navigation ?? {},
        },
      },
      RENDER_TIMEOUT_MS,
    );

    if (++worker.served >= MAX_SERVED) retire(worker);

    if (!res?.ok || typeof res.html !== "string") {
      recordFailure(bundleUrl, res?.error ?? "unknown");
      return null;
    }
    if (res.html.length > MAX_HTML_BYTES) {
      recordFailure(bundleUrl, "html too large");
      return null;
    }
    recordSuccess(bundleUrl);
    return res.html;
  } catch (err) {
    recordFailure(bundleUrl, String(err));
    return null;
  }
}

/** Diagnostics for a health endpoint / QA. Never throws. */
export function themeSsrStatus(): Record<string, unknown> {
  return {
    enabled: isThemeSsrEnabled(),
    workerScript: workerScriptPath(),
    permissionModel: supportsPermissionModel(),
    pool: { size: pool.length, max: POOL_SIZE, busy: pool.filter((w) => w.busy).length },
    cachedBundles: bundleCache.size,
    benched: [...breaker.entries()]
      .filter(([k]) => benched(k))
      .map(([k, v]) => ({ bundleUrl: k, fails: v.fails, until: v.until })),
    timeoutMs: RENDER_TIMEOUT_MS,
  };
}

function warn(event: string, detail?: unknown): void {
  // Server logs only; never surfaced to a shopper.
  console.warn(`[ssr-theme] ${event}`, detail ?? "");
}
