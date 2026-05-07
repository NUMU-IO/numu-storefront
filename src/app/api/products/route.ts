/**
 * GET /api/products?store_id=<uuid>&limit=<n>
 *
 * Client-side product list endpoint for theme bundles that need to
 * fetch products outside the SSR pre-fetch path (e.g., a "load more"
 * button on a custom landing page). Most themes should rely on
 * page.data.products from the storefront SSR pass; this is the
 * escape hatch.
 *
 * Forwards to FastAPI's `/storefront/store/{store_id}/products?limit=N`
 * with no auth — products are public data. Cookies are forwarded so
 * the backend can apply the right tenant context if needed.
 */

import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get("store_id");
  if (!storeId) {
    return NextResponse.json(
      { error: "missing_store_id", message: "store_id query param required" },
      { status: 400 },
    );
  }
  const limit = searchParams.get("limit") || "20";

  const cookie = req.headers.get("cookie") ?? "";
  const res = await fetch(
    `${API_URL}/storefront/store/${encodeURIComponent(storeId)}/products?limit=${encodeURIComponent(limit)}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      // Short-cache to coalesce bursts on the same store; not critical.
      next: { revalidate: 60, tags: [`products:${storeId}`] },
    },
  );
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
