import { NextRequest, NextResponse } from "next/server";

const PLATFORM_DOMAIN = process.env.NUMU_PLATFORM_DOMAIN || "numueg.app";

// Subdomain segments that come AFTER the [domain] in path routing.
// When the proxy sees one of these as the first path segment, it
// implies the request is missing its subdomain prefix and we need to
// rebase under whichever subdomain we can recover from Referer/cookie.
const POST_DOMAIN_SEGMENTS = new Set([
  "collections",
  "products",
  "cart",
  "checkout",
  "account",
  "search",
  "pages",
  "blogs",
]);

function subdomainFromReferer(request: NextRequest): string | null {
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    const refUrl = new URL(referer);
    const refSeg = refUrl.pathname.split("/")[1];
    if (refSeg && !POST_DOMAIN_SEGMENTS.has(refSeg)) return refSeg;
  } catch {
    /* malformed Referer */
  }
  return null;
}

function subdomainFromCookie(request: NextRequest): string | null {
  const value = request.cookies.get("numu_active_store")?.value;
  if (!value) return null;
  // Cookie holds the subdomain string (`lumiere`, `mystore`, etc.). We
  // don't trust this value beyond using it as a routing hint — the
  // [domain]/layout.tsx still validates the subdomain server-side via
  // fetchStoreByDomain.
  if (!/^[a-z0-9-]+$/i.test(value)) return null;
  if (POST_DOMAIN_SEGMENTS.has(value.toLowerCase())) return null;
  return value;
}

// Next 16 renamed the file convention from `middleware.ts` to `proxy.ts`
// and the export from `middleware` to `proxy`. Behavior is identical.
export function proxy(request: NextRequest) {
  const rawHost = (request.headers.get("host") || "").toLowerCase();
  // Strip the port — `numu.localhost:3000` should match the same rules
  // as `numu.numueg.app`. Leaving the port in breaks every endsWith()
  // comparison below.
  const hostname = rawHost.split(":")[0];
  const pathname = request.nextUrl.pathname;

  // Skip API routes and static assets
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Hostname shapes:
  //  - `numueg.app` / `localhost`           — apex; pass through
  //  - `<sub>.numueg.app` / `<sub>.localhost` — subdomain store
  //  - anything else                         — custom domain
  //
  // `*.localhost` is supported in dev because modern browsers resolve it
  // to 127.0.0.1 automatically (no hosts-file edit needed). Treat it as
  // a subdomain pattern in addition to whatever PLATFORM_DOMAIN is set to.

  // Apex passthrough.
  if (
    hostname === PLATFORM_DOMAIN ||
    hostname === `www.${PLATFORM_DOMAIN}` ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  ) {
    // Dev path-segment routing: themes naturally render absolute paths
    // like `/collections/all` (matches the prod subdomain root). On
    // apex localhost those land at `/collections/all`, miss the
    // [domain] route, and 404. We rebase under the right `<subdomain>`
    // using two signals, in order of preference:
    //
    //   1. Referer header — present on most in-app navigations.
    //   2. `numu_active_store` cookie — set by [domain]/layout.tsx
    //      on every store render. Covers deep links opened in a new
    //      tab, cross-origin Referers (e.g. iframe parents), and
    //      privacy-mode browsers that strip Referer.
    //
    // Production never hits this branch — subdomain hostnames route
    // via the hostname check above.
    const firstSeg = pathname.split("/")[1] || "";
    if (POST_DOMAIN_SEGMENTS.has(firstSeg)) {
      const subdomain =
        subdomainFromReferer(request) || subdomainFromCookie(request);
      if (subdomain) {
        const url = request.nextUrl.clone();
        url.pathname = `/${subdomain}${pathname}`;
        return NextResponse.rewrite(url);
      }
    }
    return NextResponse.next();
  }

  let storeIdentifier: string | null = null;

  if (hostname.endsWith(`.${PLATFORM_DOMAIN}`)) {
    storeIdentifier = hostname.slice(0, -(PLATFORM_DOMAIN.length + 1));
  } else if (hostname.endsWith(".localhost")) {
    // Dev convenience: `<sub>.localhost` always treated as a subdomain.
    storeIdentifier = hostname.slice(0, -".localhost".length);
  } else if (hostname) {
    storeIdentifier = hostname;
  }

  if (storeIdentifier) {
    // Self-correct the "double subdomain" case: a request to
    // `lumiere.localhost:3000/lumiere/...` (the subdomain repeated as
    // the first path segment) would naively rewrite to
    // `/lumiere/lumiere/...` and 404. This typically happens when a
    // hub button or dev link mistakenly includes `/<subdomain>` on a
    // URL that already has the subdomain in the host. Redirect to the
    // root once and let the user share clean links.
    const firstSeg = pathname.split("/")[1] || "";
    if (firstSeg.toLowerCase() === storeIdentifier.toLowerCase()) {
      const fixed = request.nextUrl.clone();
      fixed.pathname = pathname.slice(`/${firstSeg}`.length) || "/";
      return NextResponse.redirect(fixed, 301);
    }

    const url = request.nextUrl.clone();
    url.pathname = `/${storeIdentifier}${pathname}`;
    const res = NextResponse.rewrite(url);
    // Forward the original hostname (without port) so api-client can
    // distinguish subdomain vs custom-domain lookups without re-parsing.
    res.headers.set("x-numu-host", hostname);
    // Stamp the rewritten pathname so the root layout (which doesn't
    // see [domain] params) can resolve the active store for setting
    // `<html lang>` / `<html dir>`.
    res.headers.set("x-numu-pathname", url.pathname);
    return res;
  }

  // Apex passthrough still wants the pathname header so root layout
  // can resolve locale when the URL already includes the [domain]
  // segment (the dev path-segment routing case).
  const passthrough = NextResponse.next();
  passthrough.headers.set("x-numu-pathname", pathname);
  return passthrough;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
