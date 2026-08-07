/**
 * GET /api/storefront/promotions — active promotions for client components.
 *
 * The SSR layout fetches promotions via lib/promo-server for the announcement
 * bar; client surfaces (the checkout order summary's free-shipping progress +
 * auto-offer nudges) need the same data client-side. Resolves the store from
 * the host header and proxies to the backend's `/promotions/active`.
 *
 * Always 200 with `{ data }` (null when the promo feature flag is off or the
 * store can't be resolved) so a promo miss never throws in the UI.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

export async function GET(req: NextRequest) {
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

  const url = new URL(req.url);
  const locale = url.searchParams.get("locale") === "ar" ? "ar" : "en";
  const page = url.searchParams.get("page") || "/";
  const qs = new URLSearchParams({ page, device: "desktop", locale });
  // Cart context, so CATALOG-SCOPED promotions survive eligibility.
  //
  // The backend builds a VisitorContextInput from these and
  // PromotionEligibilityChecker._target_matches resolves PRODUCT / CATEGORY
  // targets against `cart_product_ids` / `cart_category_ids`. Sending neither
  // meant an untagged inclusion target could never match, so the checker
  // returned `include target ... did not match` and the promotion was dropped
  // from the response entirely — the theme never learned it existed, and a
  // merchant's "20% off this category" offer was invisible on the storefront
  // while still being charged correctly at checkout.
  //
  // Repeated params (the shape FastAPI expects for a list query), and capped so
  // a large cart can't build an unbounded query string.
  const MAX_CART_IDS = 100;
  for (const key of ["product_ids", "category_ids"] as const) {
    const values = url.searchParams.getAll(key).slice(0, MAX_CART_IDS);
    for (const v of values) {
      if (v) qs.append(key === "product_ids" ? "cart_product_ids" : "cart_category_ids", v);
    }
  }
  const subtotal = url.searchParams.get("subtotal_cents");
  if (subtotal && /^\d{1,12}$/.test(subtotal)) {
    qs.set("cart_subtotal_cents", subtotal);
  }
  const cookie = req.headers.get("cookie");

  try {
    const res = await fetch(
      `${API_URL}/storefront/store/${store.id}/promotions/active?${qs.toString()}`,
      {
        headers: { ...(cookie ? { cookie } : {}) },
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
