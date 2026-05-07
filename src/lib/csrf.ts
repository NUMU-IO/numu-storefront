/**
 * Double-submit cookie CSRF protection for cart mutations.
 *
 * Why we need it:
 *   /api/cart/* is cookie-authenticated (the customer session). A theme
 *   bundle that hits XSS on a storefront could otherwise drain the
 *   customer's cart by POSTing to /api/cart/add directly. CSRF on
 *   cookie-auth'd write endpoints is best practice; without it any
 *   credentialed request from the same origin counts as the customer.
 *
 * How it works (double-submit):
 *   1. GET /api/cart issues a `numu_csrf` cookie with a random 32-byte
 *      hex value if one isn't present. The cookie is NOT HttpOnly so
 *      client JS can read it; we use SameSite=Lax + path=/ + 1y expiry.
 *   2. The SDK's NuMuProvider reads `document.cookie`, extracts the
 *      `numu_csrf` value, and sends it as the `x-numu-csrf` header on
 *      every cart mutation.
 *   3. The proxy route (/api/cart/add etc.) reads BOTH the cookie and
 *      the header. If they don't match, we 403. An attacker on a
 *      different origin can't read the cookie (cross-origin CORS) and
 *      so can't forge the matching header.
 *
 * Why not anti-CSRF tokens minted server-side per render?
 *   The storefront is statically rendered + cached; per-request tokens
 *   would invalidate the page cache. Double-submit avoids that by
 *   keeping the secret in a long-lived cookie and proving knowledge of
 *   it via header echo.
 */

import { NextRequest } from "next/server";

const COOKIE_NAME = "numu_csrf";
const HEADER_NAME = "x-numu-csrf";

export function getCsrfCookie(req: NextRequest): string | null {
  return req.cookies.get(COOKIE_NAME)?.value ?? null;
}

/** Generate a Set-Cookie header value if none present. Caller appends to
 * an outbound response. */
export function ensureCsrfCookie(req: NextRequest): {
  value: string;
  setCookieHeader: string | null;
} {
  const existing = getCsrfCookie(req);
  if (existing) return { value: existing, setCookieHeader: null };
  const value = randomHex(32);
  // 1 year — same lifetime as a typical session — so we don't churn the
  // token on every cart fetch. Path=/ so all routes can read it.
  //
  // `Secure` only on HTTPS deployments. Browsers REJECT Secure cookies
  // on plain http (dev), so without this guard the cookie is silently
  // dropped → SDK reads no cookie → no x-numu-csrf header → backend 403s
  // every cart write. Detect via the request's protocol; default to
  // secure-on so production never accidentally drops the flag.
  const isHttps =
    req.nextUrl.protocol === "https:" ||
    req.headers.get("x-forwarded-proto") === "https";
  const secureFlag = isHttps ? "; Secure" : "";
  const setCookieHeader =
    `${COOKIE_NAME}=${value}; Path=/; Max-Age=${60 * 60 * 24 * 365}; ` +
    `SameSite=Lax${secureFlag}`;
  return { value, setCookieHeader };
}

/** Verify the inbound request carries a matching cookie + header.
 * Returns null when valid; an error message string when invalid. */
export function verifyCsrf(req: NextRequest): string | null {
  const cookie = getCsrfCookie(req);
  const header = req.headers.get(HEADER_NAME);
  if (!cookie || !header) {
    return "Missing CSRF token. Cookie + x-numu-csrf header both required.";
  }
  if (cookie !== header) {
    return "CSRF token mismatch.";
  }
  return null;
}

function randomHex(byteLen: number): string {
  // Edge-runtime-compatible: crypto.getRandomValues. Older Node fallback
  // via require would break in Edge — we never need it.
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
