/**
 * /api/storefront/track-lookup — proxy to the FastAPI guest order-lookup
 * endpoint:  POST /storefront/store/{store_id}/track/lookup
 *
 * No auth required. The /track form posts { order_number, phone, email } here
 * (exactly one of phone/email); the backend verifies the pair and answers with
 * the same public tracking payload the UUID route returns, plus the `order_id`
 * the form needs to route the shopper on to /track/{order_id}. The contact key
 * is what stands in for the unguessable UUID.
 *
 * Why `track-lookup` and not `track/lookup`: `api/storefront/track/` is a
 * dynamic `[orderId]` segment, so `/api/storefront/track/lookup` would be
 * swallowed by it and "lookup" looked up as an order id.
 *
 * Status passthrough mirrors track/[orderId]/route.ts — in particular the
 * backend's 404 goes through verbatim. It is deliberately IDENTICAL for a wrong
 * order number and a wrong contact key; never enrich it here, or order numbers
 * become enumerable.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

/**
 * The `X-Forwarded-For` chain to hand upstream.
 *
 * The backend rate-limits guest lookups per client IP. Server-to-server
 * `fetch` sends none of the shopper's headers, so without this every shopper
 * arrives as this server's address and they all share ONE bucket: the 11th
 * distinct guest in a minute — across every store on the instance — gets a
 * 429, which the form renders as "Something went wrong". One attacker at
 * 10 req/min would take guest tracking down platform-wide.
 *
 * We APPEND to the incoming chain rather than replacing it, so the hops that
 * already handled this request stay visible to the backend. `cf-connecting-ip`
 * is the edge's own view of the shopper and is preferred as the value to
 * contribute; it is normally already the head of the chain, hence the
 * duplicate check. When there is no chain at all (direct hit, local dev) the
 * single value becomes the whole header.
 *
 * This is a fairness fix, not an authentication one — the leftmost entry is
 * still whatever the shopper's own client claimed. The backend's per-order and
 * per-store lookup budgets are what actually bound brute force.
 */
function upstreamForwardedFor(req: NextRequest): string | null {
  const chain = (req.headers.get("x-forwarded-for") || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const edgeClientIp =
    req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip");
  if (edgeClientIp && !chain.includes(edgeClientIp)) {
    chain.push(edgeClientIp);
  }

  return chain.length > 0 ? chain.join(", ") : null;
}

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

  // Forward the raw body: validating the shape here would only duplicate the
  // backend's Pydantic model and risk the two drifting apart.
  const body = await req.text();
  const upstream = `${API_URL}/storefront/store/${store.id}/track/lookup`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const forwardedFor = upstreamForwardedFor(req);
  if (forwardedFor) headers["X-Forwarded-For"] = forwardedFor;
  const res = await fetch(upstream, {
    method: "POST",
    headers,
    body,
    cache: "no-store",
  });
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
