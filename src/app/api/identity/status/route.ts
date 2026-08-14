import { NextRequest } from "next/server";
import { proxyIdentity } from "@/lib/identity-proxy";

/**
 * GET /api/identity/status → /storefront/store/{store_id}/identity/status
 *   { required, otp_available, verified, phone_masked } for this cart
 *   session — what the checkout gate and the save-cart nudge consult
 *   before rendering anything.
 */
export async function GET(req: NextRequest) {
  return proxyIdentity(req, "/storefront/store/{store_id}/identity/status");
}
