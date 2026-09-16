/**
 * /api/storefront/product-requests — proxy to the FastAPI request form:
 *   POST /storefront/store/{store_id}/product-requests
 *
 * No auth. A theme's "looking for a specific book?" form posts multipart here
 * (name, email, phone, details, locale, source_url, a `website` honeypot and
 * up to five photos). The body is streamed through untouched — the backend's
 * own validation is the one validator, and re-parsing the multipart here would
 * mean re-encoding every uploaded photo for nothing.
 *
 * The backend answers 201 with the same shape whether the request was saved,
 * caught by the honeypot or rate-limited; pass it through verbatim so the
 * theme cannot tell those apart either.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";
import { upstreamForwardedFor } from "@/lib/upstream-forwarded-for";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

/** Five photos at 5 MB each, plus the text fields and multipart overhead. */
const MAX_BODY_BYTES = 27 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const host =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  if (!host) {
    return NextResponse.json({ error: "Host header missing" }, { status: 400 });
  }

  const contentType = req.headers.get("content-type") || "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 415 },
    );
  }

  // Cheap guard before we read anything: a declared length over the cap is
  // refused here rather than tying up an upstream connection with it.
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
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

  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  const headers: Record<string, string> = { "Content-Type": contentType };
  // The backend's rate limit is per shopper IP; without this every visitor
  // shares this server's bucket.
  const forwardedFor = upstreamForwardedFor(req);
  if (forwardedFor) headers["X-Forwarded-For"] = forwardedFor;

  try {
    const res = await fetch(
      `${API_URL}/storefront/store/${store.id}/product-requests`,
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
