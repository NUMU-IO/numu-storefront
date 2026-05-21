import { NextRequest } from "next/server";
import { proxyCustomer } from "@/lib/customer-proxy";

/**
 * POST /api/customer/verify-email → /storefront/store/{store_id}/auth/verify-email
 *
 * Customer clicks "Verify email" link from welcome email and lands on
 * a verify page that posts the token here. Backend marks
 * `customer.email_verified_at` and may flip a `verified` claim into
 * the auth cookie.
 */
export async function POST(req: NextRequest) {
  return proxyCustomer(req, {
    backendPath: "/storefront/store/{store_id}/auth/verify-email",
    method: "POST",
  });
}
