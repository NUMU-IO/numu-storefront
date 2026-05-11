import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

/**
 * GET /api/storefront/currencies — presentment currencies + FX rates
 * for the current store.
 *
 * Read by the SDK's `useCurrency()` hook. Light caching (60s) because
 * rates only refresh daily on the backend; no need to hit FastAPI on
 * every page load.
 */

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

export async function GET(req: NextRequest) {
  const host =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  if (!host) {
    return NextResponse.json(
      { error: "Host header missing" },
      { status: 400 },
    );
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

  const upstream = `${API_URL}/storefront/store/${store.id}/currencies`;
  const res = await fetch(upstream, {
    headers: { Accept: "application/json" },
    next: { revalidate: 60, tags: [`currencies-${store.id}`] },
  });
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
