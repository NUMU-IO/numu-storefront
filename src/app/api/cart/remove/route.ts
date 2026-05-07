/**
 * POST /api/cart/remove — proxies through to the FastAPI cart-remove
 * endpoint. CSRF + idempotency are enforced by the shared helper.
 */

import { NextRequest } from "next/server";
import { proxyCartMutation } from "@/lib/cart-proxy";

export async function POST(req: NextRequest) {
  return proxyCartMutation(req, "/storefront/cart/remove");
}
