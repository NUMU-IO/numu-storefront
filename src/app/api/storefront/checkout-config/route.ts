import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

/**
 * GET /api/storefront/checkout-config
 *   → /storefront/store/{store_id}/checkout-config
 *
 * Public (no auth) — surfaces the merchant's enabled payment methods,
 * COD-deposit policy, saved-cards flag and presentment currency so the
 * payment step renders the real options instead of a hardcoded fallback.
 *
 * The backend payload shape is still settling (Phase 2): older deployments
 * return `enabled_payment_methods: string[]` + `cod_deposit_policy`, while
 * the newer one adds `payment_methods:[{code,label,…}]`, `cod:{…}`,
 * `currency`, `saved_cards_enabled`. We pass the body through verbatim and
 * let PaymentStep normalize whichever shape it gets — so this route stays a
 * thin proxy and doesn't need to change when the backend lands the richer
 * contract.
 *
 * Store is resolved from the host the same way the sibling
 * `/api/storefront/*` routes do (x-numu-host, falling back to Host).
 */

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

export async function GET(req: NextRequest) {
  const host =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  if (!host) {
    return NextResponse.json({ error: "Host header missing" }, { status: 400 });
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

  const upstream = `${API_URL}/storefront/store/${store.id}/checkout-config`;
  const res = await fetch(upstream, {
    headers: { Accept: "application/json" },
    // Payment config rarely changes mid-session; a short cache keeps the
    // payment step snappy without hammering FastAPI on every entry.
    next: { revalidate: 30, tags: [`checkout-config-${store.id}`] },
  });
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
