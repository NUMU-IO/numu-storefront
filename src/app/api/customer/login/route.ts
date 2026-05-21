import { NextRequest } from "next/server";
import { proxyCustomer } from "@/lib/customer-proxy";

/**
 * POST /api/customer/login → /storefront/store/{store_id}/auth/login
 *
 * On success, the backend issues a `customer_access_token` cookie via
 * Set-Cookie. Our proxy forwards it through verbatim so the browser
 * stores it for subsequent /api/customer/me/* calls.
 */
export async function POST(req: NextRequest) {
  return proxyCustomer(req, {
    backendPath: "/storefront/store/{store_id}/auth/login",
    method: "POST",
  });
}
