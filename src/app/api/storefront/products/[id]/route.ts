import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

/**
 * GET /api/storefront/products/{id}
 *
 * A single product's FULL detail record, by id or slug.
 *
 * Why this route has to exist: the catalog LIST endpoint returns
 * `options: []` and `variants: []` for every product (measured on testlocal —
 * every one of 18 products, including ones the detail endpoint serves in full).
 * A theme on a listing therefore cannot tell a single-variant product from a
 * multi-variant one, so a responsible theme has to withhold quick-add entirely
 * rather than guess a size and ship an XS to someone who wanted an L.
 *
 * The detail endpoint has the data — but until now nothing on the host exposed
 * it, so there was no way to recover it without a full page navigation to the
 * PDP. That is the whole reason quick-add is dark across every V3 theme.
 *
 * Same shape as the sibling `/related` and `/reviews` proxies: resolve the
 * store from the host header (never a client-supplied store_id), forward to
 * FastAPI, and flatten the `{ success, data }` envelope to a bare product so a
 * theme can consume it without knowing the platform's envelope convention.
 *
 * Unlike `/related`, a failure here is NOT silently empty: quick-add must be
 * able to distinguish "no variants" from "could not load", or it would fall
 * back to exactly the blind add this route exists to prevent. So upstream
 * status codes are propagated.
 */

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const host =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  if (!host) {
    return NextResponse.json(
      { error: "unresolved_host", message: "Cannot resolve store from host" },
      { status: 400 },
    );
  }

  let store: { id?: string } | null = null;
  try {
    store = await fetchStoreByHost(host);
  } catch {
    return NextResponse.json(
      { error: "store_lookup_failed", message: "Cannot resolve store from host" },
      { status: 502 },
    );
  }
  if (!store?.id) {
    return NextResponse.json(
      { error: "store_not_found", message: "Cannot resolve store from host" },
      { status: 404 },
    );
  }

  const upstream =
    `${API_URL}/storefront/store/${store.id}/products/${encodeURIComponent(id)}`;

  try {
    const res = await fetch(upstream, {
      headers: { Accept: "application/json" },
      // Product detail is safe to cache briefly and is hit once per quick-add
      // open; `no-store` here would make every sheet a cold round trip.
      next: { revalidate: 60, tags: [`product-${id}`, `store-${store.id}`] },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: "upstream_error", status: res.status },
        { status: res.status === 404 ? 404 : 502 },
      );
    }
    const json = await res.json();
    // FastAPI returns { success, data: {...} }; tolerate a bare product too, so
    // the proxy survives an envelope change rather than returning `undefined`.
    const product = json?.data ?? json;
    return NextResponse.json(product, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "upstream_unreachable" },
      { status: 502 },
    );
  }
}
