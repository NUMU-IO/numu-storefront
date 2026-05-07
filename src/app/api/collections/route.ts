/**
 * GET /api/collections?store_id=<uuid>
 *
 * Client-side collection list endpoint. Forwards to FastAPI's
 * `/storefront/store/{store_id}/categories`. Same trust model as
 * /api/products — public data, cookies forwarded for tenant context.
 */

import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const storeId = searchParams.get("store_id");
  if (!storeId) {
    return NextResponse.json(
      { error: "missing_store_id", message: "store_id query param required" },
      { status: 400 },
    );
  }

  const cookie = req.headers.get("cookie") ?? "";
  const res = await fetch(
    `${API_URL}/storefront/store/${encodeURIComponent(storeId)}/categories`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      next: { revalidate: 120, tags: [`categories:${storeId}`] },
    },
  );
  const text = await res.text();
  return new NextResponse(text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
