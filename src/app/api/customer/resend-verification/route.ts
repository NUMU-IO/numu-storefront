import { NextRequest } from "next/server";
import { proxyCustomer } from "@/lib/customer-proxy";

/**
 * POST /api/customer/resend-verification → /storefront/store/{store_id}/auth/resend-verification
 *
 * Customer didn't receive (or lost) the verify email. Backend
 * rate-limits this server-side to prevent email-bombing.
 */
export async function POST(req: NextRequest) {
  return proxyCustomer(req, {
    backendPath: "/storefront/store/{store_id}/auth/resend-verification",
    method: "POST",
  });
}
