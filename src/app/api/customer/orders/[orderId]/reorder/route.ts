/**
 * POST /api/customer/orders/{orderId}/reorder
 *   → /storefront/me/orders/{order_id}/reorder
 *
 * Phase 8.5 — clones every line item from an existing order into the
 * current cart. Customer-cookie scoped (`/storefront/me/*`), so we
 * just forward the cookie via `proxyCustomer`. CSRF is required —
 * this mutates the cart.
 *
 * Backend response (proxied verbatim):
 *   { data: { added_count, skipped: [...], cart_total_items } }
 */
import { NextRequest } from "next/server";
import { proxyCustomer } from "@/lib/customer-proxy";

interface RouteContext {
  params: Promise<{ orderId: string }>;
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { orderId } = await params;
  return proxyCustomer(req, {
    backendPath: `/storefront/me/orders/${encodeURIComponent(orderId)}/reorder`,
    method: "POST",
  });
}
