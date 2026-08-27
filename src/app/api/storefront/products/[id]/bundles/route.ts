import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

/**
 * GET /api/storefront/products/{id}/bundles
 *
 * "Frequently bought together" data for a product — the merchant-curated
 * bundle, its combined price, and the bilingual section title. Consumed by the
 * theme's Quick Preview modal.
 *
 * Mirrors the sibling `related` proxy exactly: resolve the store from the host
 * (never a client-supplied store_id), forward to FastAPI's
 * `/storefront/store/{store_id}/products/{id}/bundles`, and flatten the
 * `{ success, data: {...} }` envelope to the bare object.
 *
 * Like `related`, a failure must never surface as an error: without a route
 * here the request falls through to the `[domain]/[...slug]` no-404 catch-all,
 * which answers the storefront HTML with a 200 — so `res.ok` is true and
 * `res.json()` then throws on HTML. Every failure path below returns an EMPTY
 * bundle instead, and the theme renders nothing when `bundles` is empty, which
 * is also the correct output for a merchant who simply hasn't configured one.
 */

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

/** Shape the theme treats as "nothing to show". */
const EMPTY = { bundles: [], primary_product: null, total_original: 0, total_discounted: 0 };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const host =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  if (!host) return NextResponse.json(EMPTY, { status: 200 });

  let store: { id?: string } | null = null;
  try {
    store = await fetchStoreByHost(host);
  } catch {
    return NextResponse.json(EMPTY, { status: 200 });
  }
  if (!store?.id) return NextResponse.json(EMPTY, { status: 200 });

  const upstream =
    `${API_URL}/storefront/store/${store.id}/products/${encodeURIComponent(id)}/bundles`;

  try {
    const res = await fetch(upstream, {
      headers: { Accept: "application/json" },
      // Bundles are merchant-curated and change rarely; a short revalidate
      // keeps a burst of Quick Preview opens off the API without going stale.
      next: { revalidate: 300, tags: [`bundles:${store.id}`] },
    });
    if (!res.ok) return NextResponse.json(EMPTY, { status: 200 });
    const json = await res.json();
    const data =
      json && typeof json === "object" && json.data && typeof json.data === "object"
        ? json.data
        : json;
    return NextResponse.json(data ?? EMPTY, { status: 200 });
  } catch {
    return NextResponse.json(EMPTY, { status: 200 });
  }
}
