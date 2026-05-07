/**
 * Customer-auth + account proxies.
 *
 * The FastAPI backend exposes two customer-facing route trees:
 *
 *   1. `/storefront/store/{store_id}/auth/*` — register/login/recover/
 *      reset/verify-email/resend/logout/refresh. Store-scoped.
 *   2. `/storefront/me/*` — profile/password/addresses/orders/
 *      notifications. Cookie-scoped (the `customer_access_token`
 *      cookie carries the customer + store).
 *
 * The Next.js storefront's `/api/customer/*` routes proxy to both. This
 * module centralizes the cookie/CSRF/idempotency forwarding + Set-Cookie
 * passthrough logic so individual route files stay tiny.
 *
 * Auth flow:
 *   - Auth routes (register, login, forgot-password, reset-password,
 *     verify-email, resend-verification) need the store_id baked into
 *     the URL. We resolve it from the `x-numu-host` header that
 *     proxy.ts stamps on every request — same pattern the cart proxy
 *     uses for guest carts.
 *   - "me" routes are cookie-scoped on the backend; we just forward
 *     the cookie unchanged.
 *
 * Cookie story:
 *   - Successful login/register sets a `customer_access_token` cookie
 *     scoped to the storefront domain. We forward the upstream
 *     Set-Cookie verbatim through `getSetCookie()` so the browser
 *     stores it for use on subsequent /api/customer/me/* requests.
 *   - Logout returns a Set-Cookie with Max-Age=0; same passthrough
 *     clears it from the browser.
 *
 * CSRF:
 *   - Customer-write endpoints inherit the same `numu_csrf` double-
 *     submit guard the cart uses. The shared `verifyCsrf` helper is
 *     applied to mutating proxies (login, register, recover, reset,
 *     and every /me write).
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyCsrf } from "@/lib/csrf";

const API_URL =
  process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

interface ProxyOptions {
  /** Backend path. May include `{store_id}` placeholder for auth routes —
   * we'll substitute the resolved store_id when present. */
  backendPath: string;
  /** HTTP method to forward. Defaults to the inbound request's method. */
  method?: string;
  /** Set true to require a CSRF double-submit on the inbound request.
   * Defaults to true for non-safe methods, false otherwise. */
  requireCsrf?: boolean;
}

/**
 * Resolve store_id from the x-numu-host header by hitting the
 * subdomain lookup endpoint. Cached at the layer above (apiFetch's
 * Next cache); each unique subdomain hits the backend once per
 * revalidation window.
 */
async function resolveStoreId(req: NextRequest): Promise<string | null> {
  const host = (req.headers.get("x-numu-host") || "").split(":")[0].toLowerCase();
  if (!host) return null;

  // Subdomain pattern: <sub>.numueg.app or <sub>.localhost.
  let subdomain: string | null = null;
  if (host.endsWith(".numueg.app")) {
    subdomain = host.slice(0, -".numueg.app".length);
  } else if (host.endsWith(".localhost")) {
    subdomain = host.slice(0, -".localhost".length);
  }
  if (!subdomain) {
    // Custom domain — not implemented here; auth routes require
    // subdomain resolution. Could be extended via a /by-host endpoint.
    return null;
  }

  try {
    const res = await fetch(
      `${API_URL}/storefront/store-by-subdomain/${encodeURIComponent(subdomain)}`,
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const body = await res.json();
    return body?.data?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Forward an inbound `/api/customer/*` request to the backend.
 *
 * Substitutes `{store_id}` in `backendPath` when present (auth routes).
 * Handles CSRF, cookie + idempotency-key forwarding, and Set-Cookie
 * passthrough including multi-cookie `getSetCookie()` results.
 */
export async function proxyCustomer(
  req: NextRequest,
  opts: ProxyOptions,
): Promise<NextResponse> {
  const method = (opts.method ?? req.method).toUpperCase();
  const requireCsrf = opts.requireCsrf ?? !SAFE_METHODS.has(method);

  if (requireCsrf) {
    const err = verifyCsrf(req);
    if (err) {
      return NextResponse.json(
        { success: false, error: { code: "csrf_invalid", message: err } },
        { status: 403 },
      );
    }
  }

  let path = opts.backendPath;
  if (path.includes("{store_id}")) {
    const storeId = await resolveStoreId(req);
    if (!storeId) {
      return NextResponse.json(
        {
          success: false,
          error: {
            code: "store_unknown",
            message:
              "Cannot resolve store from host. Check x-numu-host header.",
          },
        },
        { status: 400 },
      );
    }
    path = path.replace("{store_id}", storeId);
  }

  // Forward body for non-safe methods. Use raw text to avoid losing
  // shape (multipart, etc.) — auth/me write endpoints all consume JSON
  // today but using `req.text()` keeps us shape-agnostic.
  const body = SAFE_METHODS.has(method) ? undefined : await req.text();

  const headers: Record<string, string> = {};
  // Only set Content-Type when there's a body — GETs shouldn't claim
  // application/json with a zero-length payload.
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const cookie = req.headers.get("cookie");
  if (cookie) headers.cookie = cookie;
  const idem = req.headers.get("x-numu-idempotency-key");
  if (idem) headers["x-numu-idempotency-key"] = idem;
  const subdomainHeader = req.headers.get("x-numu-host");
  if (subdomainHeader) headers["x-numu-host"] = subdomainHeader;

  const upstream = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body,
    cache: "no-store",
  });
  const text = await upstream.text();

  // Build response with Set-Cookie passthrough (multi-cookie aware —
  // login + CSRF + cart_session may all be set in one response).
  const responseHeaders = new Headers({
    "Content-Type": "application/json",
  });
  const sc = (upstream.headers as Headers & {
    getSetCookie?: () => string[];
  }).getSetCookie?.();
  if (sc && sc.length > 0) {
    for (const c of sc) responseHeaders.append("set-cookie", c);
  } else {
    const single = upstream.headers.get("set-cookie");
    if (single) responseHeaders.append("set-cookie", single);
  }

  return new NextResponse(text, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
