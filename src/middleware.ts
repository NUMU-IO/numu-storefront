import { NextRequest, NextResponse } from "next/server";

const PLATFORM_DOMAIN = process.env.NUMU_PLATFORM_DOMAIN || "numueg.app";

export function middleware(request: NextRequest) {
  const hostname = (request.headers.get("host") || "").toLowerCase();
  const pathname = request.nextUrl.pathname;

  // Skip API routes and static assets
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // The hostname can take three shapes:
  //  - `numueg.app` (apex; landing page lives elsewhere) — pass through.
  //  - `<sub>.numueg.app` — subdomain store; rewrite to `/sub/...`.
  //  - anything else — custom domain; rewrite to `/<full-host>/...` so the
  //    `[domain]` route handler can look it up via the custom-domain API.
  //
  // Custom-domain branch encodes the entire hostname so backend can
  // distinguish (subdomain `mystore` vs custom `mystore.com`).

  let storeIdentifier: string | null = null;

  if (hostname === PLATFORM_DOMAIN || hostname === `www.${PLATFORM_DOMAIN}`) {
    return NextResponse.next();
  }

  if (hostname.endsWith(`.${PLATFORM_DOMAIN}`)) {
    storeIdentifier = hostname.slice(0, -(PLATFORM_DOMAIN.length + 1));
  } else if (hostname && hostname !== PLATFORM_DOMAIN) {
    storeIdentifier = hostname;
  }

  if (storeIdentifier) {
    const url = request.nextUrl.clone();
    url.pathname = `/${storeIdentifier}${pathname}`;
    const res = NextResponse.rewrite(url);
    // Forward the original hostname so api-client can choose the right
    // backend endpoint (subdomain vs custom domain) without re-parsing.
    res.headers.set("x-numu-host", hostname);
    return res;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
