import { NextRequest } from "next/server";
import { proxyCustomer } from "@/lib/customer-proxy";

/**
 * GET  /api/customer/me/addresses → /storefront/me/addresses
 *   List the customer's saved addresses (used by checkout autofill +
 *   account address book page).
 * POST /api/customer/me/addresses → /storefront/me/addresses
 *   Add a new address. Pass `is_default: true` to also set default.
 */

export async function GET(req: NextRequest) {
  return proxyCustomer(req, {
    backendPath: "/storefront/me/addresses",
    method: "GET",
  });
}

export async function POST(req: NextRequest) {
  return proxyCustomer(req, {
    backendPath: "/storefront/me/addresses",
    method: "POST",
  });
}
