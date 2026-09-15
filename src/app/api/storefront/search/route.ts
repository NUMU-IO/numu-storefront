import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

/**
 * GET /api/storefront/search?q=<term>&mode=predictive|full&types=<csv>&limit=<n>&page=<n>
 *
 * Consumed by the SDK's `useSearch` hook, which fetches this host-relative
 * path and reads `products`/`collections`/`pages`/`articles`/`total` off the
 * body or its `data` envelope.
 *
 * Without this route the request fell through to the `[domain]/[...slug]`
 * catch-all, which answers with the storefront HTML page and a 200 — so
 * `res.ok` was true, `res.json()` threw on the HTML, the hook swallowed it, and
 * EVERY V3 theme's search page showed "no results" for every query. Same
 * failure, and same fix, as the related-products route.
 *
 * The store is resolved from the host; the backend has had both endpoints all
 * along (`/storefront/store/{id}/search` and `/search/predictive`). Limits are
 * clamped to what each endpoint accepts, because an over-limit request 422s
 * upstream and, swallowed here, would look exactly like an empty result.
 */

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

const PREDICTIVE_LIMIT_MAX = 20;
const FULL_LIMIT_MAX = 100;

const EMPTY = { products: [], collections: [], pages: [], articles: [], total: 0 };

function clampInt(raw: string | null, fallback: number, max: number): string {
  const n = Number.parseInt(raw || "", 10);
  return String(Number.isFinite(n) ? Math.min(Math.max(n, 1), max) : fallback);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  if (!q) return NextResponse.json(EMPTY);

  const full = searchParams.get("mode") === "full";
  const qs = new URLSearchParams({ q });
  const types = searchParams.get("types");
  if (types) qs.set("types", types);
  qs.set(
    "limit",
    full
      ? clampInt(searchParams.get("limit"), 24, FULL_LIMIT_MAX)
      : clampInt(searchParams.get("limit"), 5, PREDICTIVE_LIMIT_MAX),
  );
  if (full) qs.set("page", clampInt(searchParams.get("page"), 1, 10_000));

  const host =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  if (!host) return NextResponse.json(EMPTY);

  let store: { id?: string } | null = null;
  try {
    store = await fetchStoreByHost(host);
  } catch {
    return NextResponse.json(EMPTY);
  }
  if (!store?.id) return NextResponse.json(EMPTY);

  const upstream =
    `${API_URL}/storefront/store/${store.id}/search${full ? "" : "/predictive"}?${qs.toString()}`;

  try {
    const res = await fetch(upstream, { cache: "no-store" });
    if (!res.ok) return NextResponse.json(EMPTY);
    const text = await res.text();
    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(EMPTY);
  }
}
