/**
 * POST /api/storefront/cart-track — abandoned-checkout recovery proxy.
 *
 * Forwards the storefront's cart snapshot to the backend's
 * `/storefront/store/{id}/cart/track`, which upserts an `abandoned_checkouts`
 * row (matched by session_fingerprint OR email) that the merchant's recovery
 * flow (WhatsApp/email) acts on. Resolves the store from the host header and
 * forwards cookies so the backend can attribute to a logged-in customer.
 *
 * Best-effort: always 204 to the caller; the cart write must never block or
 * break checkout.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

export async function POST(req: NextRequest) {
  const host =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  let store: { id?: string } | null = null;
  try {
    store = await fetchStoreByHost(host);
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  if (!store?.id) return new NextResponse(null, { status: 204 });

  const body = await req.text();
  const cookie = req.headers.get("cookie");
  try {
    await fetch(`${API_URL}/storefront/store/${store.id}/cart/track`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body,
      cache: "no-store",
    });
  } catch {
    /* best-effort */
  }
  return new NextResponse(null, { status: 204 });
}
