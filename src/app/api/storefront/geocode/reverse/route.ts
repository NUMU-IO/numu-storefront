/**
 * GET /api/storefront/geocode/reverse?lat=..&lng=..&lang=ar
 *   → /storefront/store/{store_id}/geocode/reverse?lat=..&lng=..&lang=..
 *
 * Reverse-geocoding proxy for the checkout location picker. The customer's
 * map pin coordinates are translated server-side (key hidden, Redis-cached)
 * into a structured Egyptian address (governorate slug / area / street) that
 * autofills the delivery-details form.
 *
 * Store is resolved from the `x-numu-host` header that proxy.ts stamps,
 * mirroring the cart + customer proxies. Public read (no CSRF — it's a GET).
 *
 * Soft failures pass straight through:
 *   - 503 when the backend has no geocoder configured → client treats it as
 *     "unavailable" and lets the customer proceed with manual entry.
 *   - 400 when coords are outside Egypt.
 */

import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

async function resolveStoreId(req: NextRequest): Promise<string | null> {
  const host = (req.headers.get("x-numu-host") || "")
    .split(":")[0]
    .toLowerCase();
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
      { cache: "no-store" },
    );
    if (!res.ok) return null;
    const body = await res.json();
    return body?.data?.id ?? null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
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

  const search = req.nextUrl.searchParams;
  const lat = search.get("lat");
  const lng = search.get("lng");
  const lang = search.get("lang") || "ar";
  if (!lat || !lng) {
    return NextResponse.json(
      { success: false, error: { code: "bad_request", message: "lat & lng required" } },
      { status: 400 },
    );
  }

  const qs = new URLSearchParams({ lat, lng, lang }).toString();
  const upstream = `${API_URL}/storefront/store/${storeId}/geocode/reverse?${qs}`;

  const headers: Record<string, string> = {};
  const cookie = req.headers.get("cookie");
  if (cookie) headers.cookie = cookie;
  const host = req.headers.get("x-numu-host");
  if (host) headers["x-numu-host"] = host;

  try {
    const res = await fetch(upstream, { headers, cache: "no-store" });
    // Pass status + body through unchanged. 503/400 are meaningful to the
    // client (degrade-to-manual / out-of-bounds) — don't reshape them.
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    // Network failure reaching the backend → treat as unavailable.
    return NextResponse.json(
      {
        success: false,
        error: { code: "geocode_unavailable", message: "Geocoding unavailable." },
      },
      { status: 503 },
    );
  }
}
