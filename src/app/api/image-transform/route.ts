/**
 * Image transform proxy (Phase 4.2).
 *
 * GET /api/image-transform?url=<src>&w=<width>&q=<quality>&f=<format>
 *
 * Serves resized, format-converted images for the storefront's `<Image>`
 * component. v1 ships an in-process transform via Next.js's built-in image
 * optimizer (which is already part of the framework and respects
 * `next.config.ts > images.remotePatterns`); the resolver normalizes the
 * upstream URL, validates the host, and points at `/_next/image` so we get
 * caching + AVIF/WebP negotiation for free.
 *
 * Why a proxy instead of pointing themes directly at /_next/image:
 *   - The SDK's `<Image>` doesn't know whether the consumer is on a
 *     subdomain (numu.numueg.app) or a custom domain (mystore.com).
 *     Routing through `/api/image-transform` keeps the path stable
 *     across hosts.
 *   - Lets us swap the transform backend (Cloudflare Image Resizing,
 *     Imgix, self-hosted libvips) without theme bundle changes —
 *     just edit the resolver.
 *   - Adds an allowlist gate so the proxy can't be abused as an
 *     open SSRF (themes or visitors can't request arbitrary URLs).
 *
 * ## This handler is the SLOW path
 *
 * `src/proxy.ts` calls the same resolver and serves the common case with an
 * internal `rewrite()`, so the browser never sees a hop. Requests only reach
 * this handler when middleware didn't handle them — direct/manual hits, and
 * the Cloudflare branch, which has to be a real browser redirect because
 * `/cdn-cgi/image/…` is intercepted at CF's edge and isn't a path on this
 * origin. Both call `resolveImageTransform`, so the allowlist and the clamps
 * are identical either way; see `src/lib/image-transform.ts`.
 */

import { NextRequest, NextResponse } from "next/server";
import { resolveImageTransform } from "@/lib/image-transform";

export async function GET(req: NextRequest) {
  const decision = resolveImageTransform(req.nextUrl.searchParams);

  if (decision.kind === "error") {
    return NextResponse.json(
      { error: decision.message },
      { status: decision.status },
    );
  }
  return sameOriginRedirect(decision.path);
}

/**
 * 302 to a path on the SAME origin, using a relative `Location`.
 *
 * Why not `NextResponse.redirect(new URL(path, req.nextUrl.origin))`:
 * behind the production reverse proxy `req.nextUrl.origin` is derived from the
 * address the Next server is *bound* to, not the public host — in prod that is
 * `0.0.0.0:3000`. Every transform therefore redirected the browser to
 * `https://0.0.0.0:3000/_next/image?...`, which fails with
 * ERR_ADDRESS_INVALID / ECONNREFUSED. Symptom: hero and focal-crop images
 * silently never painted (and the LCP `<link rel=preload as=image>` pointing at
 * this route became a dead preload), fleet-wide on every store.
 *
 * A relative Location is valid per RFC 7231 §7.1.2 and the browser resolves it
 * against the request URL, so the public host, port and scheme are whatever the
 * visitor actually used. That is strictly more robust than reconstructing the
 * origin from X-Forwarded-* headers, which we would then have to trust.
 */
function sameOriginRedirect(path: string): NextResponse {
  return new NextResponse(null, { status: 302, headers: { Location: path } });
}
