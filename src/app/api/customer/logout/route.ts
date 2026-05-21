import { NextRequest } from "next/server";
import { proxyCustomer } from "@/lib/customer-proxy";

/**
 * POST /api/customer/logout → /storefront/store/{store_id}/auth/logout
 *
 * Backend clears the `customer_access_token` cookie via Set-Cookie with
 * Max-Age=0; we forward through, browser clears.
 */
export async function POST(req: NextRequest) {
  return proxyCustomer(req, {
    backendPath: "/storefront/store/{store_id}/auth/logout",
    method: "POST",
  });
}
