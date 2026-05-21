/**
 * GET /api/storefront/pickup-locations
 *   → /storefront/store/{store_id}/pickup-locations
 *
 * Phase 7.2 — surfaces in-store pickup locations to the checkout
 * shipping step. Public read (no auth) and store-scoped via the
 * x-numu-host header that proxy.ts stamps.
 *
 * Returns SuccessResponse<{ id, name, address, ... }[]>.
 * Empty list when the merchant hasn't enabled any pickup locations —
 * the shipping step hides the pickup tab in that case.
 */
import { NextRequest } from "next/server";
import { proxyCustomer } from "@/lib/customer-proxy";

export async function GET(req: NextRequest) {
  return proxyCustomer(req, {
    backendPath: "/storefront/store/{store_id}/pickup-locations",
    method: "GET",
    requireCsrf: false,
  });
}
