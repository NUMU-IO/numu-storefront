import { NextRequest } from "next/server";
import { proxyCustomer } from "@/lib/customer-proxy";

/**
 * GET /api/customer/me/orders → /storefront/me/orders
 *
 * Customer order history, paginated. Backend returns the customer's
 * own orders only (cookie-scoped). 401 if not logged in.
 */
export async function GET(req: NextRequest) {
  return proxyCustomer(req, {
    backendPath: "/storefront/me/orders",
    method: "GET",
  });
}
