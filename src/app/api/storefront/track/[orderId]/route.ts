/**
 * /api/storefront/track/[orderId] — proxy to the FastAPI public order-tracking
 * endpoint:  GET /storefront/track/{order_id}
 *
 * No auth required — the endpoint resolves the store from the order and returns
 * a sanitised public view, protected only by the unguessable order UUID. Buyers
 * reach this from the confirmation email / WhatsApp link without logging in.
 */

import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;
  const upstream = `${API_URL}/storefront/track/${encodeURIComponent(orderId)}`;
  const res = await fetch(upstream, { cache: "no-store" });
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
