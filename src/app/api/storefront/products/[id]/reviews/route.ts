/**
 * /api/storefront/products/[id]/reviews — product reviews proxy.
 *
 * GET  → backend `GET /storefront/store/{sid}/products/{pid}/reviews`
 *        (public; approved reviews + aggregate stats). Null-safe: any miss
 *        returns an empty list so themes never crash on reviews.
 * POST → backend `POST …/reviews` (requires the customer_access_token
 *        cookie; body {rating, title?, body?}). Cookie + CSRF forwarded.
 *
 * Same store-by-host resolution as the sibling `related` route.
 */
import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

const EMPTY = {
  items: [],
  stats: { average: 0, count: 0, distribution: {} },
};

async function resolveStore(req: NextRequest): Promise<string | null> {
  const host =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  if (!host) return null;
  try {
    const store = await fetchStoreByHost(host);
    return store?.id ?? null;
  } catch {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const storeId = await resolveStore(req);
  if (!storeId) return NextResponse.json(EMPTY);
  const { searchParams } = new URL(req.url);
  const page = searchParams.get("page") || "1";
  const limit = searchParams.get("limit") || "20";
  try {
    const res = await fetch(
      `${API_URL}/storefront/store/${storeId}/products/${encodeURIComponent(id)}/reviews?page=${page}&limit=${limit}`,
      { cache: "no-store" },
    );
    if (!res.ok) return NextResponse.json(EMPTY);
    const body = await res.json();
    return NextResponse.json(body?.data ?? EMPTY);
  } catch {
    return NextResponse.json(EMPTY);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const storeId = await resolveStore(req);
  if (!storeId) {
    return NextResponse.json(
      { success: false, error: { code: "store_unknown", message: "Cannot resolve store." } },
      { status: 400 },
    );
  }
  const body = await req.text();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const cookie = req.headers.get("cookie");
  if (cookie) headers.cookie = cookie;
  try {
    const upstream = await fetch(
      `${API_URL}/storefront/store/${storeId}/products/${encodeURIComponent(id)}/reviews`,
      { method: "POST", headers, body, cache: "no-store" },
    );
    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json(
      { success: false, error: { code: "upstream_unreachable", message: "Reviews service unreachable." } },
      { status: 504 },
    );
  }
}
