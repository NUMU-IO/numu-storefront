/**
 * Image-transform resolution — shared by the proxy and the route handler.
 *
 * `/api/image-transform?url=…&w=…` is the stable, host-agnostic image URL
 * every theme builds (see the SDK's `focalSrc`). It doesn't serve bytes; it
 * points at whichever transform backend the storefront is configured for:
 * Cloudflare Image Resizing when `NUMU_CF_IMAGE_RESIZING=1`, otherwise Next's
 * built-in optimizer at `/_next/image`.
 *
 * ## Why this logic moved out of `route.ts`
 *
 * A Route Handler can only answer or redirect, so the endpoint answered every
 * request with a 302 to `/_next/image`. That is a full extra round trip PER
 * IMAGE — 831 bytes of nothing, on a connection where a round trip is the
 * expensive part. On vionne's mobile Lighthouse run the hero spent ~1.6 s in
 * that chain and each of the 12 product thumbnails paid the same toll again.
 *
 * `NextResponse.rewrite()` reaches the same destination with no round trip at
 * all, but it is middleware-only. So the decision is a pure function here, the
 * proxy consumes it for the fast path, and the route keeps consuming it for
 * direct hits (and for the CF path, which genuinely needs the browser to be
 * redirected — `/cdn-cgi/image/…` is intercepted at Cloudflare's edge and does
 * not exist on our origin).
 *
 * The SSRF allowlist is enforced in this module, so the fast path is gated by
 * exactly the same check as before. There is no configuration in which the
 * proxy relays a host the route would have refused.
 */

const DEFAULT_HOSTS = [
  "numueg.app",
  "r2.cloudflarestorage.com",
  "imagedelivery.net", // Cloudflare Images
  "cdn.numueg.app",
  "r2.dev", // public R2 dev/canary buckets (pub-*.r2.dev) — dev/test image host
];

const VALID_FORMATS = new Set(["webp", "avif", "jpeg", "jpg", "png"]);

export function getAllowedHosts(): string[] {
  // Env EXTENDS the defaults — it must never replace them. The defaults are
  // the platform's own image hosts (CDN/R2/uploads); every merchant image
  // lives there, so an env override that drops them 403s every product image
  // fleet-wide (exactly what happened in prod: a Heroku-era value replaced
  // the list and matched nothing). NUMU_IMAGE_HOSTS is for ADDING custom
  // hosts (e.g. a merchant's external DAM), not restricting platform ones.
  //
  // Entries are normalized to bare lowercase hostnames so common footguns
  // ("https://cdn.example.com", "cdn.example.com/path", "*.example.com")
  // still match `isHostAllowed`'s hostname comparison.
  const fromEnv = process.env.NUMU_IMAGE_HOSTS || "";
  const extra = fromEnv
    .split(",")
    .map((s) =>
      s
        .trim()
        .toLowerCase()
        .replace(/^[a-z]+:\/\//, "") // strip protocol
        .replace(/^\*\./, "") // strip wildcard prefix (suffix-match anyway)
        .replace(/[/:].*$/, ""), // strip path/port
    )
    .filter(Boolean);
  return [...new Set([...DEFAULT_HOSTS, ...extra])];
}

export function isHostAllowed(target: URL, allowed: string[]): boolean {
  const host = target.hostname.toLowerCase();
  return allowed.some(
    (allow) =>
      host === allow.toLowerCase() || host.endsWith(`.${allow.toLowerCase()}`),
  );
}

export function clampInt(
  raw: string | null,
  min: number,
  max: number,
  fallback?: number,
): number | undefined {
  if (raw == null || raw === "") return fallback;
  const n = parseInt(raw, 10);
  if (Number.isNaN(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

export function clampFloat(
  raw: string | null,
  min: number,
  max: number,
): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

export type TransformResolution =
  /** Same-origin path Next can serve internally — safe to `rewrite()`. */
  | { kind: "rewrite"; path: string }
  /**
   * Path the BROWSER must be sent to, because it is not served by this origin.
   * Only Cloudflare's `/cdn-cgi/image/…` qualifies: it is intercepted at CF's
   * edge, so an internal rewrite would resolve against Next and 404.
   */
  | { kind: "redirect"; path: string }
  | { kind: "error"; status: number; message: string };

/**
 * Decide where an `/api/image-transform` request should be served from.
 *
 * Pure: takes the query params, returns the destination. No I/O, so the proxy
 * can call it on every image request without adding latency of its own.
 */
export function resolveImageTransform(
  searchParams: URLSearchParams,
): TransformResolution {
  const src = searchParams.get("url");
  if (!src) {
    return { kind: "error", status: 400, message: "Missing `url` parameter." };
  }

  // Reject data: URIs — they don't need a transformer (the browser already has
  // the bytes) and treating them as opaque keeps the route from accidentally
  // caching megabytes of inlined image data.
  if (src.startsWith("data:")) {
    return {
      kind: "error",
      status: 400,
      message: "data: URIs cannot be transformed.",
    };
  }

  let target: URL;
  try {
    target = new URL(src, "https://placeholder/");
    if (!target.protocol.startsWith("http")) throw new Error("non-http url");
  } catch {
    return { kind: "error", status: 400, message: "Invalid `url`." };
  }

  // Relative URLs (no host on the source) get the storefront's host as their
  // effective host — those are theme-bundled assets and we can serve them
  // as-is without enforcing the allowlist.
  if (target.host && !isHostAllowed(target, getAllowedHosts())) {
    return {
      kind: "error",
      status: 403,
      message: `Host '${target.host}' is not allowed for image transforms.`,
    };
  }

  // Validated query knobs.
  const w = clampInt(searchParams.get("w"), 16, 4096);
  const q = clampInt(searchParams.get("q"), 1, 100, 75);
  const formatRaw = (searchParams.get("f") || "").toLowerCase();
  const format = VALID_FORMATS.has(formatRaw) ? formatRaw : null;

  // Focal-point knobs (Phase 3). These let a theme request a server-side SMART
  // CROP centered on the subject (e.g. a hero). They are honored ONLY when
  // Cloudflare Image Resizing is enabled (NUMU_CF_IMAGE_RESIZING=1) and a
  // target width is given; otherwise they are gracefully IGNORED and the
  // theme's CSS object-position transform still frames the image. So enabling
  // CF is a pure perf/bandwidth optimization, never a correctness dependency.
  //
  // Because they are inert with CF off, the SDK stops emitting them entirely
  // in that configuration — a URL that differs from the width-only form for no
  // visual gain is just a cache key that misses the hero's <link rel=preload>.
  // This branch stays for bundles built against an older SDK.
  const fpx = clampFloat(searchParams.get("fp-x"), 0, 1);
  const fpy = clampFloat(searchParams.get("fp-y"), 0, 1);
  const arRaw = searchParams.get("ar") || "";
  const ar = /^\d{1,3}\/\d{1,3}$/.test(arRaw) ? arRaw : null;
  const fitRaw = (searchParams.get("fit") || "").toLowerCase();
  const fit =
    fitRaw === "contain" ? "contain" : fitRaw === "cover" ? "cover" : null;

  const cfEnabled = process.env.NUMU_CF_IMAGE_RESIZING === "1";
  const hasFocalIntent =
    fpx !== undefined || fpy !== undefined || ar !== null || fit !== null;

  // Reject a source that itself embeds a CF directive — appended after our
  // options it would nest a second, attacker-controlled transform. (The host is
  // already allowlisted, so this is hardening, not the primary gate.) Such a
  // source falls through to /_next/image instead.
  const srcHasCfDirective = target.pathname.toLowerCase().includes("/cdn-cgi/");

  if (cfEnabled && hasFocalIntent && w && !srcHasCfDirective) {
    // Cloudflare Image Resizing: /cdn-cgi/image/<options>/<source-url>.
    // gravity accepts fractional coords (0.7x0.3). height is derived from the
    // aspect ratio so the crop box matches the storefront container.
    const opts: string[] = [`fit=${fit ?? "cover"}`, `width=${w}`];
    if (fpx !== undefined || fpy !== undefined) {
      opts.push(`gravity=${fpx ?? 0.5}x${fpy ?? 0.5}`);
    }
    if (ar) {
      const [num, den] = ar.split("/").map(Number);
      if (num > 0 && den > 0) opts.push(`height=${Math.round((w * den) / num)}`);
    }
    if (q) opts.push(`quality=${q}`);
    if (format) opts.push(`format=${format}`);
    // CF's path form takes the absolute source URL appended RAW (NOT
    // percent-encoded — encoding breaks its parser). We use target.href (the
    // normalized, validated URL) so stray whitespace/control chars can't
    // malform the redirect. CF options precede the source segment, so the
    // source's own query string can never override them.
    return { kind: "redirect", path: `/cdn-cgi/image/${opts.join(",")}/${target.href}` };
  }

  // Build the Next.js built-in optimizer URL. `_next/image` accepts:
  //   ?url=<encoded src>&w=<width>&q=<quality>
  // It serves AVIF when the Accept header advertises it and the request's UA
  // supports it; format= is honored when explicit.
  const optimizerParams = new URLSearchParams();
  optimizerParams.set("url", src);
  if (w) optimizerParams.set("w", String(w));
  if (q) optimizerParams.set("q", String(q));
  // Next 16 doesn't have a public `f` param, but we forward it so a future
  // swap to Cloudflare Image Resizing (which DOES accept explicit
  // `format=webp`) Just Works without theme changes.
  if (format) optimizerParams.set("f", format);

  return { kind: "rewrite", path: `/_next/image?${optimizerParams.toString()}` };
}
