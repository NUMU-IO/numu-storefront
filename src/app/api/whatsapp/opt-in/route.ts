/**
 * POST /api/whatsapp/opt-in — proxy to FastAPI's two-step storefront
 * opt-in flow (backend-030 / FR-007a + FR-007b).
 *
 * Steps (server-side, one HTTP call from the browser):
 *   1. POST /storefront/{store_slug}/checkout-session   → issues a token
 *      bound to the caller's cart + phone (30-min TTL, single-use).
 *   2. POST /storefront/{store_slug}/whatsapp/opt-in    → consumes the
 *      token + writes the opt-in row.
 *
 * The browser only sees a single endpoint. We forward cookies (so the
 * cart cookie is honored by the backend) and the CSRF header through.
 * Both upstream calls are best-effort — any failure is reported back as
 * a non-200 JSON status so the checkout page can fire-and-forget.
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

  let store: { slug?: string } | null = null;
  try {
    store = await fetchStoreByHost(host);
  } catch {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }
  if (!store?.slug) {
    return NextResponse.json({ error: "Store not found" }, { status: 404 });
  }

  let payload: { phone?: string; customer_id_hint?: string };
  try {
    payload = (await req.json()) as {
      phone?: string;
      customer_id_hint?: string;
    };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const phone = (payload.phone || "").trim();
  if (!phone) {
    return NextResponse.json({ error: "phone required" }, { status: 422 });
  }

  const headers = backendHeaders(req);

  // 1) Issue a checkout-session token.
  let token: string;
  try {
    const sessRes = await fetch(
      `${API_URL}/storefront/${store.slug}/checkout-session`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ phone, locale: "en" }),
        cache: "no-store",
      },
    );
    if (!sessRes.ok) {
      const text = await sessRes.text();
      return new NextResponse(text || "{}", {
        status: sessRes.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    const body = (await sessRes.json()) as { data?: { token?: string } };
    token = body?.data?.token || "";
    if (!token) {
      return NextResponse.json(
        { error: "Session token missing in upstream response" },
        { status: 502 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Upstream unreachable (checkout-session)" },
      { status: 502 },
    );
  }

  // 2) Use the token to write the opt-in row.
  try {
    const optInRes = await fetch(
      `${API_URL}/storefront/${store.slug}/whatsapp/opt-in`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          phone,
          checkout_session_token: token,
          customer_id_hint: payload.customer_id_hint,
        }),
        cache: "no-store",
      },
    );
    return new NextResponse(await optInRes.text(), {
      status: optInRes.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return NextResponse.json(
      { error: "Upstream unreachable (opt-in)" },
      { status: 502 },
    );
  }
}
