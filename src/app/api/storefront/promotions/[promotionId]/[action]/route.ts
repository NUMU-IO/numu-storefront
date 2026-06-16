/**
 * POST /api/storefront/promotions/{promotionId}/{action}
 *   action ∈ { events, dismiss, submit }
 *
 * Proxy for the promotion analytics/dismiss/form-capture endpoints. The
 * host's <AnnouncementBar> (and future popup/widget surfaces) POST here from
 * the browser; we resolve the store from the host header and forward to the
 * backend's `/storefront/store/{id}/promotions/{id}/{action}` with cookies
 * (so customer/visitor dismissals persist against the right identity).
 *
 * These backend endpoints are public (no CSRF) — they're fire-and-forget
 * analytics + per-visitor suppression, not state mutations on the cart/order.
 * Failures degrade silently so a tracking miss never breaks the page.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";
const ALLOWED = new Set(["events", "dismiss", "submit"]);

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ promotionId: string; action: string }> },
) {
  const { promotionId, action } = await ctx.params;
  if (!ALLOWED.has(action)) {
    return new NextResponse(null, { status: 404 });
  }

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
    const res = await fetch(
      `${API_URL}/storefront/store/${store.id}/promotions/${encodeURIComponent(
        promotionId,
      )}/${action}`,
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
    // submit returns the reveal code (201); events=202, dismiss=204. Pass the
    // body+status through so a popup can read its discount_code.
    const text = await res.text();
    return new NextResponse(text || null, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new NextResponse(null, { status: 204 });
  }
}
