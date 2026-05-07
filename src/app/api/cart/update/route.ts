/**
 * POST /api/cart/update — proxies through to the FastAPI cart-update
 * endpoint. CSRF + idempotency are enforced by the shared helper.
 */

import { NextRequest } from "next/server";
import { proxyCartMutation } from "@/lib/cart-proxy";

export async function POST(req: NextRequest) {
  return proxyCartMutation(req, "/storefront/cart/update");
}
