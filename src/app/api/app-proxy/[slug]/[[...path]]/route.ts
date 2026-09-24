import { NextRequest } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";
import { pickHeaders, REQUEST_HEADERS, RESPONSE_HEADERS } from "@/lib/app-proxy";

/**
 * `/apps/<slug>/*` on a store host (rewritten here by proxy.ts). The API
 * signs the request with the app's client secret and relays it to the app's
 * `app_proxy.url`; this route only resolves the store and forwards the few
 * headers the app may see — never the shopper's cookies or credentials.
 */

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; path?: string[] }> },
) {
  const { slug, path = [] } = await params;
  const host =
    req.headers.get("x-numu-host") || (req.headers.get("host") || "").split(":")[0];
  let store: { id?: string } | null = null;
  try {
    store = host ? await fetchStoreByHost(host) : null;
  } catch {
    store = null;
  }
  if (!store?.id) return new Response("Not found", { status: 404 });

  const upstream =
    `${API_URL}/storefront/store/${store.id}/apps/${encodeURIComponent(slug)}/proxy/` +
    path.map(encodeURIComponent).join("/") +
    req.nextUrl.search;
  let res: Response;
  try {
    res = await fetch(upstream, {
      method: req.method,
      headers: pickHeaders(req.headers, REQUEST_HEADERS),
      body: req.method === "POST" ? await req.arrayBuffer() : undefined,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return new Response("Bad gateway", { status: 502 });
  }
  return new Response(res.body, {
    status: res.status,
    headers: pickHeaders(res.headers, RESPONSE_HEADERS),
  });
}

export { handle as GET, handle as POST };
