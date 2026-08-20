/**
 * /api/payment-proof/[orderId] — proxy to the FastAPI manual-payment endpoints:
 *   GET  → /storefront/store/{store_id}/orders/{order_id}/instapay-status
 *   POST → /storefront/store/{store_id}/orders/{order_id}/payment-proof
 *
 * Backs the `/instapay/<id>` and `/vodafone-cash/<id>` resume pages: a
 * buyer who transferred out-of-band comes back to upload their receipt.
 * Resolves the store from the host and passes status + body through
 * unchanged so the page can branch on 403 / 409 / 410 / 429 itself.
 * Mirrors /api/pay/[orderId].
 *
 * ## Why the reference code is required, and cookies are not forwarded
 *
 * The backend authorizes these two endpoints by EITHER the order-owner's
 * session cookie OR the intent's reference code. This proxy deliberately
 * supports only the second:
 *
 *   - It is the only one that works for the audience. Buyers arrive from
 *     a confirmation email; most checked out as guests, and even signed-in
 *     ones open mail on a device with no storefront session.
 *   - It removes ambient authority, and with it the CSRF question. A
 *     forged cross-site POST carries cookies but cannot carry a reference
 *     code the attacker doesn't have — and an attacker who does have one
 *     can call the backend directly, so the proxy adds no protection by
 *     re-checking a double-submit token.
 *
 * The reference code is a bearer credential by design (~10^9 namespace,
 * 30-minute TTL) and the buyer already has it: it is printed at checkout,
 * emailed to them, and typed into their own transfer note.
 */

import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

// Matches MAX_IMAGE_SIZE in the API's upload_validation. Rejecting here
// too turns "413 from a proxy hop" into a friendly message, and avoids
// streaming a doomed 20 MB photo across two hops first.
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

// The upstream sanitizes + OCRs the image inline, so it is slower than a
// plain read. Still bounded, so a hung backend can't pin the worker.
const STATUS_TIMEOUT_MS = 10_000;
const UPLOAD_TIMEOUT_MS = 30_000;

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

function noStore(json: unknown, status: number): NextResponse {
  return NextResponse.json(json, { status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;
  const reference = req.nextUrl.searchParams.get("ref");
  if (!reference) {
    return noStore({ detail: "A payment reference is required." }, 400);
  }
  const storeId = await resolveStoreId(req);
  if (!storeId) {
    return noStore({ detail: "Store not found" }, 404);
  }

  const upstream =
    `${API_URL}/storefront/store/${storeId}/orders/` +
    `${encodeURIComponent(orderId)}/instapay-status` +
    `?reference=${encodeURIComponent(reference)}`;
  try {
    const res = await fetch(upstream, {
      cache: "no-store",
      signal: AbortSignal.timeout(STATUS_TIMEOUT_MS),
    });
    return passthrough(res, await res.text());
  } catch {
    return noStore({ detail: "Could not reach the payment service." }, 502);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> },
) {
  const { orderId } = await params;
  const storeId = await resolveStoreId(req);
  if (!storeId) {
    return noStore({ detail: "Store not found" }, 404);
  }

  let inbound: FormData;
  try {
    inbound = await req.formData();
  } catch {
    return noStore({ detail: "Expected a multipart upload." }, 400);
  }

  const file = inbound.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return noStore({ detail: "A screenshot of your transfer is required." }, 400);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return noStore(
      { detail: "That image is larger than 5 MB. Please upload a smaller one." },
      413,
    );
  }
  const reference = inbound.get("reference");
  if (typeof reference !== "string" || !reference.trim()) {
    return noStore({ detail: "A payment reference is required." }, 400);
  }

  // Rebuild rather than forwarding the raw stream: it re-encodes with a
  // fresh boundary (so a malformed inbound boundary can't be smuggled
  // upstream) and lets us drop any field the client wasn't asked for.
  const outbound = new FormData();
  outbound.append("file", file, file.name || "proof.jpg");
  outbound.append("reference", reference.trim());
  for (const key of ["transaction_ref", "declared_amount_cents", "idempotency_key"]) {
    const value = inbound.get(key);
    if (typeof value === "string" && value !== "") outbound.append(key, value);
  }

  const upstream =
    `${API_URL}/storefront/store/${storeId}/orders/` +
    `${encodeURIComponent(orderId)}/payment-proof`;
  try {
    const res = await fetch(upstream, {
      method: "POST",
      body: outbound,
      cache: "no-store",
      signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
    });
    return passthrough(res, await res.text());
  } catch {
    return noStore(
      { detail: "Upload timed out. Please check your connection and try again." },
      504,
    );
  }
}
