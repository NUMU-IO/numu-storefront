/**
 * Proxy for the phone-first identity endpoints
 * (`/storefront/store/{store_id}/identity/*`).
 *
 * Same skeleton as `customer-proxy.ts` (CSRF, store_id substitution,
 * Set-Cookie passthrough) with ONE deliberate difference, borrowed from
 * `cart-proxy.ts`: the forwarded `x-numu-host` header FALLS BACK to the raw
 * `host` when the middleware didn't stamp one (1-level hosts like
 * `<store>.numueg.app`). The backend's `get_cart_owner` resolves the GUEST
 * store from that header — without the fallback every anonymous identity
 * call would 400 before reaching the OTP logic. `proxyCustomer` doesn't
 * need it because its auth routes resolve the store from the URL, not the
 * cookie owner.
 *
 * Set-Cookie passthrough matters twice here:
 *   - issue/status echo the `numu_cart_session` cookie (get_cart_owner
 *     re-sets it to slide the TTL);
 *   - verify mints `customer_access_token` + refresh when the phone
 *     matches an existing customer — the login-on-verify flow.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyCsrf } from "@/lib/csrf";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

const STORE_LOOKUP_TIMEOUT_MS = 5_000;
// issue waits on a real WhatsApp send (GOWA jitter + transport RTT).
const IDENTITY_TIMEOUT_MS = 15_000;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function resolveHost(req: NextRequest): string {
  return (req.headers.get("x-numu-host") || req.headers.get("host") || "")
    .split(":")[0]
    .toLowerCase();
}

async function resolveStoreId(req: NextRequest): Promise<string | null> {
  const host = resolveHost(req);
  if (!host) return null;

  let subdomain: string | null = null;
  if (host.endsWith(".numueg.app")) {
    subdomain = host.slice(0, -".numueg.app".length);
  } else if (host.endsWith(".localhost")) {
    subdomain = host.slice(0, -".localhost".length);
  }
  if (!subdomain) return null;

  try {
    const res = await fetch(
      `${API_URL}/storefront/store-by-subdomain/${encodeURIComponent(subdomain)}`,
      { cache: "no-store", signal: AbortSignal.timeout(STORE_LOOKUP_TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    const body = await res.json();
    return body?.data?.id ?? null;
  } catch {
    return null;
  }
}

export async function proxyIdentity(
  req: NextRequest,
  backendPath: string,
): Promise<NextResponse> {
  const method = req.method.toUpperCase();

  if (!SAFE_METHODS.has(method)) {
    const err = verifyCsrf(req);
    if (err) {
      return NextResponse.json(
        { success: false, error: { code: "csrf_invalid", message: err } },
        { status: 403 },
      );
    }
  }

  const storeId = await resolveStoreId(req);
  if (!storeId) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "store_unknown",
          message: "Cannot resolve store from host.",
        },
      },
      { status: 400 },
    );
  }
  const path = backendPath.replace("{store_id}", storeId);

  const body = SAFE_METHODS.has(method) ? undefined : await req.text();

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const cookie = req.headers.get("cookie");
  if (cookie) headers.cookie = cookie;
  // Host fallback — see module docstring.
  const host = resolveHost(req);
  if (host) headers["x-numu-host"] = host;

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(IDENTITY_TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    return NextResponse.json(
      {
        success: false,
        error: {
          code: timedOut ? "upstream_timeout" : "upstream_unreachable",
          message: timedOut
            ? `Identity service did not respond within ${IDENTITY_TIMEOUT_MS}ms.`
            : "Identity service is unreachable.",
        },
      },
      { status: 504 },
    );
  }

  const text = await upstream.text();
  const responseHeaders = new Headers({ "Content-Type": "application/json" });
  const sc = (
    upstream.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie?.();
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
