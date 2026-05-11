import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

/**
 * GET /api/storefront/apps — list installed apps for the current store.
 *
 * The SDK's `useApp()` and the customizer's apps panel both call this.
 * We resolve the store from the host header (subdomain or custom
 * domain) and proxy to
 * `GET /storefront/store/{store_id}/apps` on FastAPI.
 *
 * No cache: app installs change rarely but immediately matter for the
 * customizer flow, so we serve fresh.
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

  const upstream = `${API_URL}/storefront/store/${store.id}/apps`;
  const res = await fetch(upstream, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  // Pass through the upstream JSON + status as-is. Lets the SDK
  // distinguish 200 (with list) vs 404 (store missing) vs 5xx
  // (transient) without us re-shaping the body.
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
