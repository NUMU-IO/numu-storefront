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
