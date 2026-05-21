import { NextRequest } from "next/server";
import { proxyCustomer } from "@/lib/customer-proxy";

/**
 * PUT /api/customer/me/password → /storefront/me/password
 *
 * Customer changes their password from inside the account dashboard
 * (different flow from forgot-password / reset). Backend requires the
 * current password as confirmation.
 */
export async function PUT(req: NextRequest) {
  return proxyCustomer(req, {
    backendPath: "/storefront/me/password",
    method: "PUT",
  });
}
