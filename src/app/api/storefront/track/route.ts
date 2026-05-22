import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { fetchStoreByHost } from "@/lib/api-client";

/**
 * POST /api/storefront/track — funnel event ingestion proxy.
 *
 * The SDK's `useAnalytics().track()` POSTs here from inside the
 * BYOT theme. We resolve the store from the host header (subdomain
 * or custom domain), enrich the payload with the
 * ``numu_attribution`` cookie when the SDK didn't already send the
 * envelope (older themes / fallback), then forward to FastAPI's
 * funnel-event endpoint.
 *
 * Why this proxy exists rather than direct SDK -> FastAPI:
 * 1. Same-origin call from the theme means cookies work naturally
 *    (no SameSite / CORS gymnastics).
 * 2. Host -> store_id lookup happens once at the edge; the SDK
 *    doesn't need to know the store UUID.
 * 3. We have a single chokepoint to add request-shaping (e.g. server-
 *    side fanout to GA4 / Meta CAPI) without bumping the SDK.
 *
 * Failure mode: any upstream error returns 204 (No Content) so a
 * misbehaving backend never breaks the customer's page. The funnel
 * dashboard tolerates dropped events better than the customer
 * tolerates a broken theme.
 */

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

interface TrackBody {
  // Strict funnel-event shape (SDK >= feat/sdk-funnel-tracking).
  path?: string;
  fingerprint?: string;
  step?: string;
  step_data?: unknown;
  event_id?: string;
  referrer?: string;
  attribution?: unknown;

  // Legacy / non-funnel shape — the SDK still posts these for pixel-
  // fanout events. We forward them but the backend's funnel_events
  // pipeline will ignore them (no `step`, no `fingerprint`).
  event?: string;
  payload?: unknown;
  ts?: number;
}

export async function POST(req: NextRequest) {
  const host =
    req.headers.get("x-numu-host") ||
    (req.headers.get("host") || "").split(":")[0];
  if (!host) {
    // No host = no store context = we cannot route. Silent 204; the
    // SDK's caller doesn't need to know.
    return new NextResponse(null, { status: 204 });
  }

  let store: { id?: string } | null = null;
  try {
    store = await fetchStoreByHost(host);
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  if (!store?.id) {
    return new NextResponse(null, { status: 204 });
  }

  let body: TrackBody;
  try {
    body = (await req.json()) as TrackBody;
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  // Server-side attribution fallback: if the SDK didn't include the
  // envelope in the body (older SDK version), read the cookie
  // server-side. Same-origin to the theme runtime so the cookie is
  // visible here even when it isn't visible to the cross-origin
  // backend.
  if (!body.attribution) {
    try {
      const cookieStore = await cookies();
      const raw = cookieStore.get("numu_attribution")?.value;
      if (raw) {
        body.attribution = JSON.parse(decodeURIComponent(raw));
      }
    } catch {
      /* malformed cookie — leave attribution absent */
    }
  }

  const upstream = `${API_URL}/storefront/store/${store.id}/track`;
  try {
    await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // No-keepalive: the SDK already uses keepalive on the SDK ->
      // proxy hop; the proxy -> upstream hop is server-to-server and
      // doesn't need it.
      cache: "no-store",
    });
  } catch {
    /* analytics outage must not surface to the customer */
  }

  // Always 204 to the SDK. We don't care what the upstream said —
  // the SDK doesn't read this response.
  return new NextResponse(null, { status: 204 });
}
