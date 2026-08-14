import { NextRequest } from "next/server";
import { proxyIdentity } from "@/lib/identity-proxy";

/**
 * POST /api/identity/otp/verify → /storefront/store/{store_id}/identity/otp/verify
 *   Body: { otp_id, code, phone }. On VERIFIED the response may carry
 *   customer_known + a prefill profile, and — via Set-Cookie passthrough —
 *   the customer auth cookies (login-on-verify for returning customers).
 */
export async function POST(req: NextRequest) {
  return proxyIdentity(req, "/storefront/store/{store_id}/identity/otp/verify");
}
