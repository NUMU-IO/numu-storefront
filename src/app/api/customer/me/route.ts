import { NextRequest } from "next/server";
import { proxyCustomer } from "@/lib/customer-proxy";

/**
 * GET /api/customer/me → /storefront/me/profile
 *   Returns the logged-in customer's profile. Used by NuMuProvider's
 *   mount effect to hydrate the customer context from cookie state.
 *
 * PUT /api/customer/me → /storefront/me/profile
 *   Update name / phone / marketing preferences.
 *
 * Anonymous (no cookie) GETs return 401 — themes branch on null
 * customer in `useCustomer()` to render Login link instead.
 */

export async function GET(req: NextRequest) {
  return proxyCustomer(req, {
    backendPath: "/storefront/me/profile",
    method: "GET",
  });
}

export async function PUT(req: NextRequest) {
  return proxyCustomer(req, {
    backendPath: "/storefront/me/profile",
    method: "PUT",
  });
}
