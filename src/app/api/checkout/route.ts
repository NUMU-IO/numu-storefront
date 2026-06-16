/**
 * POST /api/checkout — proxy to FastAPI's
 *   POST /storefront/store/{store_id}/checkout
 *
 * Resolves the store from the host (subdomain/custom-domain), forwards
 * the body verbatim, and stamps standard cart cookies + CSRF + the
 * idempotency-key header through. The backend creates the order in
 * PENDING and returns either a payment_url to redirect to or
 * provider-specific payment_data for client-side capture.
 *
 * The storefront's review step posts here; we don't expose any other
 * verbs (the backend route is POST-only).
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

function backendHeaders(req: NextRequest): HeadersInit {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  const cookie = req.headers.get("cookie");
  if (cookie) (headers as Record<string, string>).cookie = cookie;
  const csrf = req.headers.get("x-numu-csrf");
  if (csrf) (headers as Record<string, string>)["x-numu-csrf"] = csrf;
  const idem = req.headers.get("idempotency-key");
  if (idem) (headers as Record<string, string>)["idempotency-key"] = idem;
  return headers;
}

export async function POST(req: NextRequest) {
  const host =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  if (!host) {
    return NextResponse.json(
      { error: "Host header missing" },
      { status: 400 },
    );
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

  // The review step posts `shipping_address.line1`/`line2`, but the backend's
  // CheckoutRequest requires `address_line1`/`address_line2`. Rename here so the
  // order isn't rejected with a 422 missing-field error.
  const raw = await req.text();
  let body = raw;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const fixAddr = (a: unknown): unknown => {
      if (!a || typeof a !== "object") return a;
      const addr = { ...(a as Record<string, unknown>) };
      if (addr.address_line1 === undefined && addr.line1 !== undefined)
        addr.address_line1 = addr.line1;
      if (addr.address_line2 === undefined && addr.line2 !== undefined)
        addr.address_line2 = addr.line2;
      delete addr.line1;
      delete addr.line2;
      return addr;
    };
    if (parsed.shipping_address)
      parsed.shipping_address = fixAddr(parsed.shipping_address);
    if (parsed.billing_address)
      parsed.billing_address = fixAddr(parsed.billing_address);
    body = JSON.stringify(parsed);
  } catch {
    /* not JSON — forward verbatim */
  }
  const upstream = `${API_URL}/storefront/store/${store.id}/checkout`;
  const res = await fetch(upstream, {
    method: "POST",
    headers: backendHeaders(req),
    body,
    cache: "no-store",
  });
  // Pass status + body through unchanged so the page can branch on
  // 201 (success → redirect to payment_url or thank-you), 400 (form
  // errors), 409 (out-of-stock), etc., without us re-shaping anything.
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
