import { NextRequest } from "next/server";
import { proxyCustomer } from "@/lib/customer-proxy";

/**
 * POST /api/customer/reset → /storefront/store/{store_id}/auth/reset-password
 *
 * Customer arrives at /account/reset?token=… from the recovery email,
 * picks a new password. Backend rotates credentials + revokes all
 * existing customer-access tokens.
 */
export async function POST(req: NextRequest) {
  return proxyCustomer(req, {
    backendPath: "/storefront/store/{store_id}/auth/reset-password",
    method: "POST",
  });
}
