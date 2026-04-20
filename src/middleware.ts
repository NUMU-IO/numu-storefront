import { NextRequest, NextResponse } from "next/server";

const PLATFORM_DOMAIN = process.env.NUMU_PLATFORM_DOMAIN || "numu.io";

export function middleware(request: NextRequest) {
  const hostname = request.headers.get("host") || "";
  const pathname = request.nextUrl.pathname;

  // Skip API routes and static assets
  if (pathname.startsWith("/api/") || pathname.startsWith("/_next/") || pathname.includes(".")) {
    return NextResponse.next();
  }

  // Extract store identifier from hostname
  let storeIdentifier: string | null = null;

  if (hostname.endsWith(`.${PLATFORM_DOMAIN}`)) {
    // Subdomain: mystore.numu.io
    storeIdentifier = hostname.replace(`.${PLATFORM_DOMAIN}`, "");
  } else if (!hostname.includes(PLATFORM_DOMAIN)) {
    // Custom domain: mystore.com
    storeIdentifier = hostname;
  }

  if (storeIdentifier) {
    // Rewrite to /[domain]/... route
    const url = request.nextUrl.clone();
    url.pathname = `/${storeIdentifier}${pathname}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
