/**
 * /api/pay/[orderId] — proxy to the FastAPI recovery-payment endpoints:
 *   GET  → /storefront/store/{store_id}/pay/{order_id}   (order pay view)
 *   POST → /storefront/store/{store_id}/pay/{order_id}   (initiate payment)
 *
 * Resolves the store from the host (subdomain/custom-domain) and forwards
 * the request, passing status + body through unchanged so the page can
 * branch on 200 / 404 / 409 itself. Mirrors /api/checkout.
 *
 * Public + UUID-scoped — the buyer reaches this from the COD-recovery
 * WhatsApp deep-link without logging in, so no auth is required.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

function hostOf(req: NextRequest): string | null {
  return (
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0] ||
    null
  );
}

async function resolveStoreId(req: NextRequest): Promise<string | null> {
  const host = hostOf(req);
  if (!host) return null;
  try {
    const store = await fetchStoreByHost(host);
    return store?.id || null;
  } catch {
    return null;
  }
}

function passthrough(res: Response, body: string): NextResponse {
  return new NextResponse(body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;
  const storeId = await resolveStoreId(req);
  if (!storeId) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }
  const upstream = `${API_URL}/storefront/store/${storeId}/pay/${encodeURIComponent(orderId)}`;
  const res = await fetch(upstream, { cache: "no-store" });
  return passthrough(res, await res.text());
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;
  const storeId = await resolveStoreId(req);
  if (!storeId) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const idem = req.headers.get("idempotency-key");
  if (idem) headers["idempotency-key"] = idem;

  const upstream = `${API_URL}/storefront/store/${storeId}/pay/${encodeURIComponent(orderId)}`;
  const res = await fetch(upstream, {
    method: "POST",
    headers,
    body: await req.text(),
    cache: "no-store",
  });
  return passthrough(res, await res.text());
}
