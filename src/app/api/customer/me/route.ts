import { NextRequest, NextResponse } from "next/server";
import { proxyCustomer } from "@/lib/customer-proxy";

/**
 * GET /api/customer/me → /storefront/me/profile
 *   Returns the logged-in customer's profile. Used by NuMuProvider's
 *   mount effect to hydrate the customer context from cookie state.
 *
 * PUT /api/customer/me → /storefront/me/profile
 *   Update name / phone / marketing preferences.
 *
 * Anonymous GETs return 200 `{ data: null }`, NOT 401. Being logged out
 * is the NORMAL state for a shopper, not an error — and both consumers
 * (SDK NuMuProvider + CustomerBridgeProvider) fire this probe on every
 * page mount, so a 401 painted a red console error per navigation on
 * every store (browsers always log non-2xx fetches; that can't be
 * silenced from JS). Both consumers already treat a null/id-less body
 * as anonymous, so the 200 shape needs no client changes. PUT keeps
 * real status codes — mutating while logged out IS an error.
 */

export async function GET(req: NextRequest) {
  const res = await proxyCustomer(req, {
    backendPath: "/storefront/me/profile",
    method: "GET",
  });
  if (res.status === 401) {
    return NextResponse.json({ data: null });
  }
  return res;
}

export async function PUT(req: NextRequest) {
  return proxyCustomer(req, {
    backendPath: "/storefront/me/profile",
    method: "PUT",
  });
}
