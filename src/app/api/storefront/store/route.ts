import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

/**
 * GET /api/storefront/store
 *
 * Returns the resolved store for the current host. The payment step uses
 * this to learn the `store.id` it needs to look up the customer's saved
 * cards (`/api/customer/saved-cards?store_id=…`). Resolved server-side from
 * the host (x-numu-host → Host) via the same `fetchStoreByHost` the rest of
 * the storefront uses, so the browser never has to know the store id.
 *
 * Read-only; returns the normalized StoreData (currency + country mapped).
 */

export async function GET(req: NextRequest) {
  const host =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  if (!host) {
    return NextResponse.json({ error: "Host header missing" }, { status: 400 });
  }

  try {
    const store = await fetchStoreByHost(host);
    if (!store?.id) {
      return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }
    return NextResponse.json({ data: store });
  } catch {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }
}
