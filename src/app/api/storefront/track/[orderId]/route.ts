/**
 * /api/storefront/track/[orderId] — proxy to the FastAPI public order-tracking
 * endpoint:  GET /storefront/track/{order_id}?store={store_id}
 *
 * No auth required — the endpoint returns a sanitised public view, protected
 * by the unguessable order UUID. Buyers reach this from the confirmation
 * email / WhatsApp link without logging in.
 *
 * `store` is the store this host serves, so one store's domain cannot show
 * another store's order by its UUID: the API answers that with the same 404 as
 * an unknown order. A host that is no store gets that 404 too.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost, internalFetch } from "@/lib/api-client";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;
  const host =
    req.headers.get("x-numu-host") || (req.headers.get("host") || "").split(":")[0];
  const store = host ? await fetchStoreByHost(host).catch(() => null) : null;
  if (!store?.id) {
    return NextResponse.json({ detail: "Order not found" }, { status: 404 });
  }
  const upstream = `${API_URL}/storefront/track/${encodeURIComponent(orderId)}?store=${encodeURIComponent(store.id)}`;
  const res = await internalFetch(upstream, { cache: "no-store" });
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
