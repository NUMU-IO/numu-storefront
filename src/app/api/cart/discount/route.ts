/**
 * POST/DELETE /api/cart/discount — proxies discount apply / remove.
 * CSRF + idempotency are enforced by the shared helper.
 */

import { NextRequest } from "next/server";
import { proxyCartMutation } from "@/lib/cart-proxy";

export async function POST(req: NextRequest) {
  return proxyCartMutation(req, "/storefront/cart/discount", "POST");
}

export async function DELETE(req: NextRequest) {
  return proxyCartMutation(req, "/storefront/cart/discount", "DELETE");
}
