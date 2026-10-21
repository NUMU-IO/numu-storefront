import { NextRequest } from "next/server";
import { fetchStoreByHost, internalFetch } from "@/lib/api-client";

/**
 * POST `/api/apps/reviews/write?t=<token>` — the Reviews app's write form on
 * the store's own origin (the `/reviews/write` page).
 *
 * The form carries text and photos, so it is multipart and cannot go through
 * the JSON relay next door (`/api/apps/[slug]/[...path]`, 8 KB). The body is
 * forwarded as is to NUMU-api with the internal-service headers; the API
 * checks the token, every field and every photo. A plain form post (no
 * script) goes back to the page with 303; the page's script asks for JSON.
 */

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";
/** The API's edge takes 10 MB; the page shrinks photos well below this. */
const MAX_BYTES = 9 * 1024 * 1024;
/** `token_urlsafe` tokens only. */
const TOKEN = /^[A-Za-z0-9_-]{1,64}$/;

export async function POST(req: NextRequest) {
  const host =
    req.headers.get("x-numu-host") || (req.headers.get("host") || "").split(":")[0];
  let store: { id?: string } | null = null;
  try {
    store = host ? await fetchStoreByHost(host) : null;
  } catch {
    store = null;
  }
  const token = req.nextUrl.searchParams.get("t") ?? "";
  if (!store?.id || !TOKEN.test(token)) {
    return Response.json({ detail: "Not found" }, { status: 404 });
  }

  const json = (req.headers.get("accept") ?? "").includes("application/json");
  const back = (query: string) =>
    new Response(null, {
      status: 303,
      headers: { Location: `/reviews/write?t=${token}&${query}` },
    });
  const fail = (status: number, detail: string) =>
    json ? Response.json({ detail }, { status }) : back(`error=${detail}`);

  const type = req.headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data")) return fail(415, "bad_form");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES) {
    return fail(413, "too_large");
  }
  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return fail(413, "too_large");

  let res: Response;
  try {
    res = await internalFetch(
      `${API_URL}/storefront/store/${store.id}/apps/reviews/write`,
      {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": type },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      },
    );
  } catch {
    return fail(502, "failed");
  }
  if (json) {
    return new Response(res.body, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") || "application/json",
        "Cache-Control": "no-store",
      },
    });
  }
  // 409: the same form sent twice; the first one saved it.
  if (res.ok || res.status === 409) return back("done=1");
  return back(`error=${res.status === 422 ? "bad_form" : "failed"}`);
}
