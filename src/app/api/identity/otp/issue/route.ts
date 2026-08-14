import { NextRequest } from "next/server";
import { proxyIdentity } from "@/lib/identity-proxy";

/**
 * POST /api/identity/otp/issue → /storefront/store/{store_id}/identity/otp/issue
 *   Body: { phone, language? }. Sends a WhatsApp verification code for this
 *   cart session. 429 carries {code: otp_cooldown|otp_hourly_limit},
 *   503 {code: otp_unavailable|otp_send_failed}.
 */
export async function POST(req: NextRequest) {
  return proxyIdentity(req, "/storefront/store/{store_id}/identity/otp/issue");
}
