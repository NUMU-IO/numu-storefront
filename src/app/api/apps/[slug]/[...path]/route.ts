import { NextRequest } from "next/server";
import { fetchStoreByHost, internalServiceHeaders } from "@/lib/api-client";
import { formReturnTo, relayPath } from "@/lib/app-relay";

/**
 * `/api/apps/<slug>/<path>` — an app's shopper routes on the store's own
 * origin (Back in Stock: `config`, `subscribe`, `unsubscribe/<token>`).
 *
 * Resolves the store from the host, forwards to NUMU-api with the
 * internal-service headers, and passes the status and body through unchanged.
 * Unknown apps and odd paths answer 404 here. Never `/apps/*`: on a store host
 * proxy.ts rewrites that to the app proxy.
 */

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

async function handle(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; path: string[] }> },
) {
  const { slug, path } = await params;
  const host =
    req.headers.get("x-numu-host") || (req.headers.get("host") || "").split(":")[0];
  let store: { id?: string } | null = null;
  try {
    store = host ? await fetchStoreByHost(host) : null;
  } catch {
    store = null;
  }
  const upstream = store?.id ? relayPath(store.id, slug, path) : null;
  if (!upstream) return Response.json({ detail: "Not found" }, { status: 404 });

  // App routes take a few hundred bytes; refuse a body declared bigger.
  if (Number(req.headers.get("content-length") ?? 0) > 8_192) {
    return Response.json({ detail: "Too large" }, { status: 413 });
  }
  const contentType = req.headers.get("content-type");
  const body = req.method === "POST" ? await req.text() : "";
  // App routes take JSON; a form POST (the no-script unsubscribe form, a
  // mail client's one-click) carries nothing the API reads.
  const json = (contentType ?? "").startsWith("application/json");
  let res: Response;
  try {
    res = await fetch(`${API_URL}${upstream}`, {
      method: req.method,
      headers: {
        Accept: "application/json",
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...(await internalServiceHeaders()),
      },
      body: req.method === "POST" && json ? body : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return Response.json({ detail: "Upstream unreachable" }, { status: 502 });
  }

  const back = req.method === "POST" ? formReturnTo(slug, path, contentType, body, res.ok) : null;
  if (back) return new Response(null, { status: 303, headers: { Location: back } });
  return new Response(res.body, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export { handle as GET, handle as POST };
