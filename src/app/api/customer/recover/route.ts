import { NextRequest } from "next/server";
import { proxyCustomer } from "@/lib/customer-proxy";

/**
 * POST /api/customer/recover → /storefront/store/{store_id}/auth/forgot-password
 *
 * Issues a password-reset email. We don't reveal whether the email
 * actually exists (anti-enumeration) — same response regardless.
 */
export async function POST(req: NextRequest) {
  return proxyCustomer(req, {
    backendPath: "/storefront/store/{store_id}/auth/forgot-password",
    method: "POST",
  });
}
