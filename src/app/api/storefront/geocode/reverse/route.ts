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
import { fetchStoreByHost } from "@/lib/api-client";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

export async function GET(req: NextRequest) {
  // Resolve the store the same way every other `/api/storefront/*` proxy does
  // — via the shared `fetchStoreByHost`, which understands subdomain stores,
  // the canonical apex, parallel-env infixes (`<slug>.v3.test.numueg.app`) AND
  // custom BYOT domains. The previous bespoke resolver only handled plain
  // `*.numueg.app` / `*.localhost`, so on a custom domain or a v3.test host it
  // returned 400 and the checkout map silently stopped autofilling the address.
  const host =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  if (!host) {
    return NextResponse.json(
      {
        success: false,
        error: { code: "store_unknown", message: "Host header missing." },
      },
      { status: 400 },
    );
  }

  let storeId: string | undefined;
  try {
    const store = await fetchStoreByHost(host);
    storeId = store?.id;
  } catch {
    storeId = undefined;
  }
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
  headers["x-numu-host"] = host;

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
