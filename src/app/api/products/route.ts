/**
 * GET /api/products?store_id=<uuid>&limit=<n>[&page=<n>][&category_id=<uuid>][&search=<term>]
 *
 * Client-side product list endpoint for theme bundles that need to
 * fetch products outside the SSR pre-fetch path (e.g., a "load more"
 * button, or a home shelf that shows one category). Most themes should
 * rely on page.data.products from the storefront SSR pass; this is the
 * escape hatch.
 *
 * Forwards to FastAPI's `/storefront/store/{store_id}/products` with no
 * auth — products are public data. Cookies are forwarded so the backend
 * can apply the right tenant context if needed.
 *
 * Only `limit` used to reach the backend, although it has always accepted
 * `page`, `category_id` and `search`. So a theme could not ask for the next
 * page, and a "Fantasy" shelf could only pick from whatever the first slice
 * held — on a large catalogue several genre shelves found nothing and showed
 * the same books. Each parameter is validated before it is forwarded, and
 * `limit` is clamped to the backend's 1–100 (an over-limit request 422s).
 */

import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMIT_MAX = 100;
const SEARCH_MAX = 100;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get("store_id");
  if (!storeId) {
    return NextResponse.json(
      { error: "missing_store_id", message: "store_id query param required" },
      { status: 400 },
    );
  }

  const qs = new URLSearchParams();
  const limit = Number.parseInt(searchParams.get("limit") || "", 10);
  qs.set("limit", String(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), LIMIT_MAX) : 20));

  const page = Number.parseInt(searchParams.get("page") || "", 10);
  if (Number.isFinite(page) && page > 1) qs.set("page", String(page));

  const categoryId = searchParams.get("category_id");
  if (categoryId && UUID_RE.test(categoryId)) qs.set("category_id", categoryId);

  const search = (searchParams.get("search") || "").trim().slice(0, SEARCH_MAX);
  if (search) qs.set("search", search);

  const cookie = req.headers.get("cookie") ?? "";
  const res = await fetch(
    `${API_URL}/storefront/store/${encodeURIComponent(storeId)}/products?${qs.toString()}`,
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
