/**
 * GET /api/customer/saved-cards?store_id={id} → /storefront/me/saved-cards
 *
 * Phase 7.5 — surface the authenticated customer's saved cards to
 * the checkout payment step (and any theme that wants to render a
 * "Pay with •••• 4242" picker via `useCustomerSavedCards()` in the
 * SDK, which will land in a follow-up).
 *
 * Anonymous → 401 (themes hide the saved-cards UI when no customer).
 */
import { NextRequest } from "next/server";
import { proxyCustomer } from "@/lib/customer-proxy";

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get("store_id");
  const qs = storeId ? `?store_id=${encodeURIComponent(storeId)}` : "";
  return proxyCustomer(req, {
    backendPath: `/storefront/me/saved-cards${qs}`,
    method: "GET",
  });
}
