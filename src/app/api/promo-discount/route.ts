/**
 * GET /api/promo-discount?code=<code>&to=<relative-path>
 *
 * Follow-target for a promo (banner / widget / popup) CTA when the merchant set
 * an auto-apply discount. We pin the coupon to the shopper's cart server-side
 * (so it's already applied at add-to-cart / checkout, no typing), forward the
 * `numu_cart_session` Set-Cookie, then redirect to the CTA's real destination.
 *
 * A top-level navigation (no CSRF token available), so we call the backend
 * directly — pinning a public coupon code to the shopper's own cart is
 * low-risk. `to` is constrained to a same-origin relative path to prevent an
 * open redirect. Any failure still forwards the shopper to `to`.
 */

import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";
const TIMEOUT_MS = 8_000;

/** Only allow root-relative paths — blocks `//evil.com` and absolute URLs. */
function safeReturnPath(raw: string | null): string {
  if (!raw) return "/";
  try {
    const dec = decodeURIComponent(raw);
    if (dec.startsWith("/") && !dec.startsWith("//")) return dec;
  } catch {
    /* malformed — fall through to home */
  }
  return "/";
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Relative Location — the browser resolves it against the public host it
  // requested. Building an absolute URL from req.nextUrl.origin yields the
  // container's internal https://0.0.0.0:3000 behind the nginx/Cloudflare
  // proxy. `to` is validated root-relative by safeReturnPath (no open redirect).
  const to = safeReturnPath(req.nextUrl.searchParams.get("to"));
  const code = (req.nextUrl.searchParams.get("code") || "").trim();

  const redirectTo = (setCookies: string[] = []): NextResponse => {
    const out = new NextResponse(null, { status: 303, headers: { Location: to } });
    for (const c of setCookies) out.headers.append("set-cookie", c);
    return out;
  };

  if (!code) return redirectTo();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const cookie = req.headers.get("cookie");
  if (cookie) headers.cookie = cookie;
  const host =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  if (host) headers["x-numu-host"] = host;

  try {
    const res = await fetch(`${API_URL}/storefront/cart/discount`, {
      method: "POST",
      headers,
      body: JSON.stringify({ code }),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const sc =
      (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ??
      (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
    return redirectTo(sc);
  } catch {
    return redirectTo();
  }
}
