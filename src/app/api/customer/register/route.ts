import { NextRequest } from "next/server";
import { proxyCustomer } from "@/lib/customer-proxy";

/**
 * POST /api/customer/register → /storefront/store/{store_id}/auth/register
 *
 * Returns 201 + customer payload + `customer_access_token` cookie. Some
 * stores require email verification before login is fully usable; the
 * backend still issues the cookie so the customer can click "verify"
 * from the verification email and land in a logged-in state.
 */
export async function POST(req: NextRequest) {
  return proxyCustomer(req, {
    backendPath: "/storefront/store/{store_id}/auth/register",
    method: "POST",
  });
}
