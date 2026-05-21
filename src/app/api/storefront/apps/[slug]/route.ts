import { NextRequest, NextResponse } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

/**
 * GET /api/storefront/apps/{slug} — fetch one installed app's manifest
 * + per-store settings.
 *
 * Used by the SDK's `useApp(slug)` hook. 404 from upstream propagates
 * through so the hook can surface `{ available: false }`.
 */

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
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

  const upstream = `${API_URL}/storefront/store/${store.id}/apps/${encodeURIComponent(slug)}`;
  const res = await fetch(upstream, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  return new NextResponse(await res.text(), {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
