import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

/**
 * GET /api/storefront/products/{id}/related?limit=<n>
 *
 * Same-category recommendations for a product detail page. Consumed by the
 * SDK's `useRelatedProducts(productId)` hook, which fetches this host-relative
 * path (no store_id — the store is resolved server-side from the host) and
 * reads the items off `json.items` | `json.data` (array) | a bare array.
 *
 * Without this route the SDK's request fell through to the `[domain]/[...slug]`
 * no-404 catch-all, which returns the storefront HTML page with a 200 — so
 * `res.ok` was true, `res.json()` then threw on the HTML, and EVERY V3 theme's
 * PDP silently showed no related products. We resolve the store from the host
 * (same path as the other storefront proxies), forward to FastAPI's
 * `/storefront/store/{store_id}/products/{id}/related`, and flatten its
 * `{ data: { items, total } }` envelope to `{ items, total }` (a shape the SDK
 * parser matches directly).
 */

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const limit = searchParams.get("limit") || "4";

  const host =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  if (!host) {
    return NextResponse.json({ items: [], total: 0 }, { status: 200 });
  }

  let store: { id?: string } | null = null;
  try {
    store = await fetchStoreByHost(host);
  } catch {
    return NextResponse.json({ items: [], total: 0 }, { status: 200 });
  }
  if (!store?.id) {
    return NextResponse.json({ items: [], total: 0 }, { status: 200 });
  }

  const upstream =
    `${API_URL}/storefront/store/${store.id}/products/${encodeURIComponent(id)}` +
    `/related?limit=${encodeURIComponent(limit)}`;

  try {
    const res = await fetch(upstream, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ items: [], total: 0 }, { status: 200 });
    }
    const json = await res.json();
    // FastAPI returns { success, data: { items, total } }; also tolerate a
    // bare { items } or a top-level array so the proxy survives shape changes.
    const items = Array.isArray(json)
      ? json
      : Array.isArray(json?.data?.items)
        ? json.data.items
        : Array.isArray(json?.items)
          ? json.items
          : Array.isArray(json?.data)
            ? json.data
            : [];
    return NextResponse.json({ items, total: items.length }, { status: 200 });
  } catch {
    // Recommendations are non-critical — never surface an error to the PDP.
    return NextResponse.json({ items: [], total: 0 }, { status: 200 });
  }
}
