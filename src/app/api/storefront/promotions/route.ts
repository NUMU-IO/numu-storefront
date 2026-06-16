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
