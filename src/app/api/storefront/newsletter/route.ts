/**
 * /api/storefront/newsletter — proxy to the FastAPI newsletter signup:
 *   POST /storefront/store/{store_id}/newsletter/subscribe
 *
 * No auth. The SDK's `lib-newsletter` section posts `{ email, website }` here
 * (`website` is a honeypot the form hides). The backend answers 202 with the
 * same body whether the email is new, already a customer, or caught by the
 * honeypot — pass it through verbatim, never enrich it.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";
import { upstreamForwardedFor } from "@/lib/upstream-forwarded-for";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

export async function POST(req: NextRequest) {
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

  // Raw body: the backend's Pydantic model is the one validator.
  const body = await req.text();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  // The backend's newsletter tier is per IP; without this every shopper
  // shares this server's bucket.
  const forwardedFor = upstreamForwardedFor(req);
  if (forwardedFor) headers["X-Forwarded-For"] = forwardedFor;

  try {
    const res = await fetch(
      `${API_URL}/storefront/store/${store.id}/newsletter/subscribe`,
      { method: "POST", headers, body, cache: "no-store" },
    );
    return new NextResponse(await res.text(), {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "Upstream unreachable" }, { status: 502 });
  }
}
