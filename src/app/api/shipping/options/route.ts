/**
 * POST /api/shipping/options — proxy to FastAPI's
 *   POST /storefront/store/{store_id}/shipping/options
 *
 * The shipping step posts the resolved address; the backend returns
 * the rate list specific to that zone + cart weight + value. We
 * don't cache — rates are merchant-configurable and the wrong cache
 * would surface stale prices in a flow that immediately commits the
 * order against them.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

export async function POST(req: NextRequest) {
  const host =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  if (!host) {
    return NextResponse.json({ error: "Host missing" }, { status: 400 });
  }

  let store: { id?: string } | null = null;
  try {
    store = await fetchStoreByHost(host);
  } catch {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }
  if (!store?.id) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const headers: HeadersInit = { "Content-Type": "application/json" };
  const cookie = req.headers.get("cookie");
  if (cookie) (headers as Record<string, string>).cookie = cookie;
  const body = await req.text();
  const upstream = `${API_URL}/storefront/store/${store.id}/shipping/options`;
  const res = await fetch(upstream, {
    method: "POST",
    headers,
    body,
    cache: "no-store",
  });
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
