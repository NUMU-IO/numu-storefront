/**
 * POST /api/cart/add — proxies through to the FastAPI cart-add endpoint.
 *
 * The SDK calls this without knowing the backend URL; this route owns
 * cookie/session forwarding so theme code stays portable across hosts.
 */

import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8000/api/v1";

export async function POST(req: NextRequest) {
  const body = await req.text();
  const cookie = req.headers.get("cookie") ?? "";
  const res = await fetch(`${API_URL}/storefront/cart/add`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body,
    cache: "no-store",
  });
  const text = await res.text();
  const headers: HeadersInit = { "Content-Type": "application/json" };
  // Surface Set-Cookie so the cart session sticks.
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) (headers as Record<string, string>)["set-cookie"] = setCookie;
  return new NextResponse(text, { status: res.status, headers });
}
