/**
 * POST /api/cart/add — proxies through to the FastAPI cart-add endpoint.
 *
 * The SDK calls this without knowing the backend URL; this route owns
 * cookie/session forwarding so theme code stays portable across hosts.
 * CSRF + idempotency are enforced by the shared cart-proxy helper.
 */

import { NextRequest } from "next/server";
import { proxyCartMutation } from "@/lib/cart-proxy";

export async function POST(req: NextRequest) {
  return proxyCartMutation(req, "/storefront/cart/add");
}
