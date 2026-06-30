/**
 * Image transform proxy (Phase 4.2).
 *
 * GET /api/image-transform?url=<src>&w=<width>&q=<quality>&f=<format>
 *
 * Serves resized, format-converted images for the storefront's
 * `<Image>` component. v1 ships an in-process transform via Next.js's
 * built-in image optimizer (which is already part of the framework
 * and respects `next.config.ts > images.remotePatterns`); the route
 * normalizes the upstream URL, validates the host, and 302s to
 * `/_next/image` so we get caching + AVIF/WebP negotiation for free.
 *
 * Why a proxy instead of pointing themes directly at /_next/image:
 *   - The SDK's `<Image>` doesn't know whether the consumer is on a
 *     subdomain (numu.numueg.app) or a custom domain (mystore.com).
 *     Routing through `/api/image-transform` keeps the path stable
 *     across hosts.
 *   - Lets us swap the transform backend (Cloudflare Image Resizing,
 *     Imgix, self-hosted libvips) without theme bundle changes —
 *     just edit this route.
 *   - Adds an allowlist gate so the proxy can't be abused as an
 *     open SSRF (themes or visitors can't request arbitrary URLs).
 *
 * Allowlist:
 *   - The storefront's `NUMU_IMAGE_HOSTS` env var (comma-separated)
 *     defines hostnames we'll relay. Defaults cover the platform's
 *     CDN + R2 + the merchant uploads endpoint. `data:` URIs are
 *     rejected outright — the SDK should never request data URIs
 *     through the transformer.
 */

import { NextRequest, NextResponse } from "next/server";

const DEFAULT_HOSTS = [
  "numueg.app",
  "r2.cloudflarestorage.com",
  "imagedelivery.net", // Cloudflare Images
  "cdn.numueg.app",
  "r2.dev", // public R2 dev/canary buckets (pub-*.r2.dev) — dev/test image host
];

const VALID_FORMATS = new Set(["webp", "avif", "jpeg", "jpg", "png"]);

function getAllowedHosts(): string[] {
  const fromEnv = process.env.NUMU_IMAGE_HOSTS || "";
  const list = fromEnv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length > 0 ? list : DEFAULT_HOSTS;
}

function isHostAllowed(target: URL, allowed: string[]): boolean {
  const host = target.hostname.toLowerCase();
  return allowed.some(
    (allow) =>
      host === allow.toLowerCase() ||
      host.endsWith(`.${allow.toLowerCase()}`),
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const src = searchParams.get("url");
  if (!src) {
    return NextResponse.json(
      { error: "Missing `url` parameter." },
      { status: 400 },
    );
  }

  // Reject data: URIs — they don't need a transformer (the browser
  // already has the bytes) and treating them as opaque keeps the
  // route from accidentally caching megabytes of inlined image data.
  if (src.startsWith("data:")) {
    return NextResponse.json(
      { error: "data: URIs cannot be transformed." },
      { status: 400 },
    );
  }

  let target: URL;
  try {
    target = new URL(src, "https://placeholder/");
    if (!target.protocol.startsWith("http")) {
      throw new Error("non-http url");
    }
  } catch {
    return NextResponse.json(
      { error: "Invalid `url`." },
      { status: 400 },
    );
  }

  const allowed = getAllowedHosts();
  // Relative URLs (no host on the source) get the storefront's host
  // as their effective host — those are theme-bundled assets and we
  // can serve them as-is without enforcing the allowlist.
  if (target.host && !isHostAllowed(target, allowed)) {
    return NextResponse.json(
      { error: `Host '${target.host}' is not allowed for image transforms.` },
      { status: 403 },
    );
  }

  // Validated query knobs.
  const w = clampInt(searchParams.get("w"), 16, 4096);
  const q = clampInt(searchParams.get("q"), 1, 100, 75);
  const formatRaw = (searchParams.get("f") || "").toLowerCase();
  const format = VALID_FORMATS.has(formatRaw) ? formatRaw : null;

  // Focal-point knobs (Phase 3). These let a theme request a server-side
  // SMART CROP centered on the subject (e.g. a hero). They are honored ONLY
  // when Cloudflare Image Resizing is enabled (NUMU_CF_IMAGE_RESIZING=1) and a
  // target width is given; otherwise they are gracefully IGNORED and the
  // theme's CSS object-position transform still frames the image. So enabling
  // CF is a pure perf/bandwidth optimization, never a correctness dependency.
  const fpx = clampFloat(searchParams.get("fp-x"), 0, 1);
  const fpy = clampFloat(searchParams.get("fp-y"), 0, 1);
  const arRaw = searchParams.get("ar") || "";
  const ar = /^\d{1,3}\/\d{1,3}$/.test(arRaw) ? arRaw : null;
  const fitRaw = (searchParams.get("fit") || "").toLowerCase();
  const fit = fitRaw === "contain" ? "contain" : fitRaw === "cover" ? "cover" : null;

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
    const cfUrl = `${req.nextUrl.origin}/cdn-cgi/image/${opts.join(",")}/${target.href}`;
    return NextResponse.redirect(cfUrl, 302);
  }

  // Build the Next.js built-in optimizer URL. `_next/image` accepts:
  //   ?url=<encoded src>&w=<width>&q=<quality>
  // It serves AVIF when the Accept header advertises it and the
  // request's UA supports it; format= is honored when explicit.
  const optimizerParams = new URLSearchParams();
  optimizerParams.set("url", src);
  if (w) optimizerParams.set("w", String(w));
  if (q) optimizerParams.set("q", String(q));
  // Next 16 doesn't have a public `f` param, but we forward it so a
  // future swap to Cloudflare Image Resizing (which DOES accept
  // explicit `format=webp`) Just Works without theme changes.
  if (format) optimizerParams.set("f", format);

  // 302 to the optimizer. Browsers cache the redirect target with the
  // optimizer's own headers (immutable + 1y for hashed filenames).
  const target302 = `/_next/image?${optimizerParams.toString()}`;
  return NextResponse.redirect(new URL(target302, req.nextUrl.origin), 302);
}

function clampInt(
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

function clampFloat(
  raw: string | null,
  min: number,
  max: number,
): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}
