/**
 * Cart API for the Next.js storefront.
 *
 * The @numu/theme-sdk's NuMuProvider posts to /api/cart/{add,remove,update,
 * discount}. This single route file (with sibling files for add/remove/etc.)
 * proxies those requests through to the FastAPI backend, attaching the
 * customer's session cookie. Each handler is a thin pass-through; the
 * backend owns cart state.
 *
 * GET /api/cart  — return the current cart for the visitor.
 */

import { NextRequest, NextResponse } from "next/server";
import { adaptCart } from "@/lib/adapt-cart";
import { ensureCsrfCookie } from "@/lib/csrf";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

function backendHeaders(req: NextRequest): HeadersInit {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  const cookie = req.headers.get("cookie");
  if (cookie) (headers as Record<string, string>).cookie = cookie;
  // Fall back to the request's own Host when the proxy didn't stamp
  // `x-numu-host` (the SDK's browser fetch to /api/cart doesn't set it).
  // Without this the backend can't resolve the store for a guest cart and
  // returns 400 "Unable to identify store" — so the cart never loads.
  const subdomain =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  if (subdomain) (headers as Record<string, string>)["x-numu-host"] = subdomain;
  return headers;
}

export async function GET(req: NextRequest) {
  const res = await fetch(`${API_URL}/storefront/cart`, {
    method: "GET",
    headers: backendHeaders(req),
    cache: "no-store",
  });
  let body = await res.text();
  // Adapt the backend envelope/field-names to the SDK Cart shape so the
  // theme's useCart() reads a populated cart (only on success bodies).
  if (res.ok) {
    try {
      body = JSON.stringify(adaptCart(JSON.parse(body)));
    } catch {
      // Non-JSON / unexpected body — pass through untouched.
    }
  }

  // First /api/cart fetch is also where we mint the CSRF cookie. The
  // SDK calls /api/cart on mount, so by the time any cart write runs
  // the cookie is in place. The SDK reads it via document.cookie and
  // echoes it in `x-numu-csrf`; the four cart-write routes verify the
  // double-submit. Without this any XSS in a theme can drain a
  // customer cart by directly POSTing /api/cart/add.
  //
  // Forward upstream Set-Cookie too — the backend's guest-cart logic
  // mints `numu_cart_session` on first GET, and we'd lose anonymous
  // cart persistence if we dropped that here.
  const { setCookieHeader } = ensureCsrfCookie(req);
  const headers = new Headers({ "Content-Type": "application/json" });
  if (setCookieHeader) headers.append("set-cookie", setCookieHeader);
  const upstream = (res.headers as Headers & {
    getSetCookie?: () => string[];
  }).getSetCookie?.();
  if (upstream && upstream.length > 0) {
    for (const c of upstream) headers.append("set-cookie", c);
  } else {
    const single = res.headers.get("set-cookie");
    if (single) headers.append("set-cookie", single);
  }

  return new NextResponse(body, {
    status: res.status,
    headers,
  });
}
