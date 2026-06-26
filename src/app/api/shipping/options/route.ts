/**
 * POST /api/shipping/options — proxy to FastAPI's
 *   POST /storefront/store/{store_id}/shipping/options
 *
 * The shipping step posts the resolved address; the backend returns
 * the rate list specific to that zone + cart weight + value. We
 * don't cache — rates are merchant-configurable and the wrong cache
 * would surface stale prices in a flow that immediately commits the
 * order against them.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

export async function POST(req: NextRequest) {
  const host =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  if (!host) {
    return NextResponse.json({ error: "Host missing" }, { status: 400 });
  }

  let store: { id?: string } | null = null;
  try {
    store = await fetchStoreByHost(host);
  } catch {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }
  if (!store?.id) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  const headers: HeadersInit = { "Content-Type": "application/json" };
  const cookie = req.headers.get("cookie");
  if (cookie) (headers as Record<string, string>).cookie = cookie;

  // The checkout's ShippingStep posts `{ shipping_address: {...} }`, but the
  // backend's /shipping/options requires `{ governorate_code, cart_subtotal_cents }`
  // and rejects an extra `shipping_address` (422). Bridge the two here: resolve
  // the governorate NAME the address carries (e.g. "Cairo") to the store's ISO
  // code (e.g. "EG-C") via /shipping/governorates, and the subtotal from the cart.
  const incoming = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  let payload: unknown = incoming;
  const addr = incoming?.shipping_address as Record<string, unknown> | undefined;
  if (addr && incoming.governorate_code === undefined) {
    const want = String(addr.state ?? addr.city ?? "").trim().toLowerCase();
    let governorate_code = String(addr.state ?? "");
    try {
      const gRes = await fetch(
        `${API_URL}/storefront/store/${store.id}/shipping/governorates`,
        { headers, cache: "no-store" },
      );
      const gJson = await gRes.json().catch(() => null);
      const govs =
        ((gJson?.data ?? gJson ?? []) as { code?: string; name?: string }[]) || [];
      const match = govs.find(
        (g) =>
          String(g.code).toLowerCase() === want ||
          String(g.name).toLowerCase() === want,
      );
      if (match?.code) governorate_code = match.code;
    } catch {
      /* fall back to the raw state value */
    }
    let cart_subtotal_cents = 0;
    try {
      const cRes = await fetch(`${API_URL}/storefront/cart`, {
        headers,
        cache: "no-store",
      });
      const cJson = await cRes.json().catch(() => null);
      const cart = (cJson?.data ?? cJson ?? {}) as Record<string, unknown>;
      const items = (cart.items as { total_price?: number }[]) || [];
      cart_subtotal_cents =
        Number(cart.subtotal ?? cart.subtotal_cents ?? 0) ||
        items.reduce((n, it) => n + (Number(it.total_price ?? 0) || 0), 0);
    } catch {
      /* leave 0 */
    }
    payload = {
      governorate_code,
      cart_subtotal_cents,
      cod_requested: Boolean(incoming.cod_requested),
      ...(incoming.coupon_code ? { coupon_code: incoming.coupon_code } : {}),
    };
  }

  const upstream = `${API_URL}/storefront/store/${store.id}/shipping/options`;
  const res = await fetch(upstream, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
