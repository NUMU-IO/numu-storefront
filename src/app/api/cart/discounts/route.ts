/**
 * POST /api/cart/discounts — preview the cart's automatic-offer + coupon
 * discount totals.
 *
 * Stateless read-style compute (no cart mutation, so no CSRF gate — mirrors
 * GET /api/storefront/promotions). Resolves the store from the host header and
 * proxies to the backend's `/storefront/store/{id}/cart/discounts`, which runs
 * the SAME DiscountCalculator the order-create path uses — so the number shown
 * in the order summary reconciles with what the order is charged.
 *
 * Cookies are forwarded so the backend resolves the optional customer and
 * derives `is_logged_in` from it (logged-in-only offers like VIP% then match
 * checkout, where the guest/customer split is identical).
 *
 * Always 200 with `{ data }` (null when the store can't be resolved or the
 * backend errors) so a preview miss degrades quietly — the summary just falls
 * back to subtotal + shipping, never throwing in the UI.
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
    return NextResponse.json({ data: null });
  }
  if (!store?.id) return NextResponse.json({ data: null });

  const body = await req.text();
  const cookie = req.headers.get("cookie");

  try {
    const res = await fetch(
      `${API_URL}/storefront/store/${store.id}/cart/discounts`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cookie ? { cookie } : {}),
        },
        body,
        cache: "no-store",
      },
    );
    if (!res.ok) return NextResponse.json({ data: null });
    const text = await res.text();
    return new NextResponse(text, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json({ data: null });
  }
}
