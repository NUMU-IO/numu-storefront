/**
 * GET /api/cart/recover?cart=<recover_id>
 *
 * Landing route for the WhatsApp / email abandoned-cart recovery link. The
 * apex redirector (numueg.app/cart/<sub>/<id>) 302s the shopper here; we call
 * the backend to rebuild their session cart from the saved abandoned checkout
 * (or their still-live customer cart), forward the `numu_cart_session`
 * Set-Cookie so the cart sticks to this browser, then redirect to /cart with
 * the items restored.
 *
 * It's a top-level browser navigation (not a JS-initiated mutation), so there's
 * no CSRF token to check — the backend endpoint only ever adds the shopper's
 * OWN items to their OWN fresh session, and `recover_id` is an unguessable
 * UUID. Any failure still lands the shopper on /cart (their current cart)
 * rather than an error page.
 */

import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";
const RECOVER_TIMEOUT_MS = 8_000;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const recoverId = req.nextUrl.searchParams.get("cart");

  // Redirect to /cart regardless of outcome, attaching any Set-Cookie the
  // backend issued so the rebuilt session cart binds to this browser.
  //
  // Use a RELATIVE Location ("/cart") — the browser resolves it against the
  // public host it actually requested (<store>.numueg.app). Building an
  // absolute URL from req.nextUrl.origin returns the container's internal
  // bind address (https://0.0.0.0:3000) behind the nginx/Cloudflare proxy,
  // which sent shoppers to a dead 0.0.0.0 host.
  const toCart = (setCookies: string[] = []): NextResponse => {
    const res = new NextResponse(null, {
      status: 303,
      headers: { Location: "/cart" },
    });
    for (const c of setCookies) res.headers.append("set-cookie", c);
    return res;
  };

  if (!recoverId) return toCart();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const cookie = req.headers.get("cookie");
  if (cookie) headers.cookie = cookie;
  // Backend resolves the store from x-numu-host for the guest session.
  const host =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  if (host) headers["x-numu-host"] = host;

  try {
    const res = await fetch(`${API_URL}/storefront/cart/recover`, {
      method: "POST",
      headers,
      body: JSON.stringify({ recover_id: recoverId }),
      cache: "no-store",
      signal: AbortSignal.timeout(RECOVER_TIMEOUT_MS),
    });
    const sc =
      (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ??
      (res.headers.get("set-cookie") ? [res.headers.get("set-cookie") as string] : []);
    return toCart(sc);
  } catch {
    // Timeout / transport failure — still show the shopper their cart.
    return toCart();
  }
}
