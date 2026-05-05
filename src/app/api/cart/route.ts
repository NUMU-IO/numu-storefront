/**
 * Cart API for the Next.js storefront.
 *
 * The @numu/theme-sdk's NuMuProvider posts to /api/cart/{add,remove,update,
 * discount}. This single route file (with sibling files for add/remove/etc.)
 * proxies those requests through to the FastAPI backend, attaching the
 * customer's session cookie. Each handler is a thin pass-through; the
 * backend owns cart state.
 *
 * GET /api/cart  — return the current cart for the visitor.
 */

import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8000/api/v1";

function backendHeaders(req: NextRequest): HeadersInit {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  const cookie = req.headers.get("cookie");
  if (cookie) (headers as Record<string, string>).cookie = cookie;
  const subdomain = req.headers.get("x-numu-host");
  if (subdomain) (headers as Record<string, string>)["x-numu-host"] = subdomain;
  return headers;
}

export async function GET(req: NextRequest) {
  const res = await fetch(`${API_URL}/storefront/cart`, {
    method: "GET",
    headers: backendHeaders(req),
    cache: "no-store",
  });
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
