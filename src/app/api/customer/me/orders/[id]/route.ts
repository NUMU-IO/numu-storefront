import { NextRequest } from "next/server";
import { proxyCustomer } from "@/lib/customer-proxy";

/**
 * GET /api/customer/me/orders/[id] → /storefront/me/orders/[id]
 *
 * Single order detail (line items, addresses, payments, fulfillments).
 * Backend rejects with 404 if the order doesn't belong to the cookie's
 * customer, regardless of whether it exists for someone else (avoids
 * order-id enumeration).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return proxyCustomer(req, {
    backendPath: `/storefront/me/orders/${encodeURIComponent(id)}`,
    method: "GET",
  });
}
