/**
 * Shared cart-proxy helper. Each route under `/api/cart/{add,remove,update,
 * discount}` is a thin POST passthrough plus three things this module
 * centralizes:
 *
 *   1. CSRF verification (double-submit cookie).
 *   2. Idempotency-key forwarding — clients generate a UUID per
 *      user-intended action and send it as `x-numu-idempotency-key`. We
 *      forward it to the FastAPI backend, which dedupes against Redis so
 *      a double-clicked Add-to-Cart only mutates state once.
 *   3. Cookie + Set-Cookie passthrough so the cart session sticks across
 *      the proxy boundary.
 *
 * Backend support for idempotency is opt-in: routes that don't honor the
 * header will simply ignore it. The plumbing is here so the wire format
 * is stable from day one.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyCsrf } from "@/lib/csrf";

// Match the rest of the storefront's defaults — the API runs on 8021
// in this dev setup. Override with NUMU_API_URL in env for staging/prod.
const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

export async function proxyCartMutation(
  req: NextRequest,
  backendPath: string,
  method: "POST" | "DELETE" = "POST",
): Promise<NextResponse> {
  // 1. CSRF gate. Skipping this on cookie-auth'd writes is what lets
  //    XSS-in-a-theme drain a logged-in customer's cart.
  const csrfError = verifyCsrf(req);
  if (csrfError) {
    return NextResponse.json(
      { error: "csrf_invalid", message: csrfError },
      { status: 403 },
    );
  }

  // 2. Forward request body + relevant headers to FastAPI.
  const body = method === "DELETE" ? undefined : await req.text();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const cookie = req.headers.get("cookie");
  if (cookie) headers.cookie = cookie;
  const idempotency = req.headers.get("x-numu-idempotency-key");
  if (idempotency) headers["x-numu-idempotency-key"] = idempotency;
  // Fall back to the request's own Host when the proxy didn't stamp
  // `x-numu-host` — otherwise guest cart writes 400 on store resolution.
  const subdomain =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  if (subdomain) headers["x-numu-host"] = subdomain;

  const res = await fetch(`${API_URL}${backendPath}`, {
    method,
    headers,
    body,
    cache: "no-store",
  });
  const text = await res.text();

  // Build the response. `Headers` lets us append multiple Set-Cookie
  // entries — important because the backend now emits a guest-cart
  // cookie (`numu_cart_session`) alongside any session cookies. A
  // single string-valued `set-cookie` would collapse them.
  const responseHeaders = new Headers({ "Content-Type": "application/json" });
  const sc = (res.headers as Headers & {
    getSetCookie?: () => string[];
  }).getSetCookie?.();
  if (sc && sc.length > 0) {
    for (const c of sc) responseHeaders.append("set-cookie", c);
  } else {
    const single = res.headers.get("set-cookie");
    if (single) responseHeaders.append("set-cookie", single);
  }

  return new NextResponse(text, { status: res.status, headers: responseHeaders });
}
