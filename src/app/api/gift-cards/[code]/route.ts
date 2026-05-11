/**
 * GET /api/gift-cards/{code} → /storefront/store/{store_id}/gift-cards/{code}
 *
 * Phase 8.3 — public balance check. No auth required, so we use
 * `proxyCustomer` only for its store_id resolution + cookie passthrough;
 * CSRF is disabled (safe method).
 *
 * The backend returns 404 for any non-redeemable card (expired,
 * depleted, voided, wrong store) — the response shape stays uniform
 * so this proxy doesn't reveal whether a code is "real but used up"
 * vs "doesn't exist." `useGiftCardBalance` in the SDK maps 404 to
 * a single "not valid or used up" message.
 */
import { NextRequest } from "next/server";
import { proxyCustomer } from "@/lib/customer-proxy";

interface RouteContext {
  params: Promise<{ code: string }>;
}

export async function GET(req: NextRequest, { params }: RouteContext) {
  const { code } = await params;
  return proxyCustomer(req, {
    backendPath: `/storefront/store/{store_id}/gift-cards/${encodeURIComponent(code)}`,
    method: "GET",
    requireCsrf: false,
  });
}
