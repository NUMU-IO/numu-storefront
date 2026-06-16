/**
 * Server-side CAPI/funnel event fire for Next route handlers.
 *
 * Some funnel events originate from a server route rather than a page — e.g.
 * AddToCart, which the theme triggers by POSTing /api/cart/add (a user action,
 * not a route the host renders). This helper lets such a route push a funnel
 * event to the backend's meta_capi fanout: it resolves the store from the host
 * header and forwards the visitor's cookies (incl. `_fbp`/`_fbc`) for match
 * quality. Bounded + best-effort — call it from `after()` so it never blocks
 * or breaks the response.
 *
 * NOTE: this is the CONVERSIONS-API (server) leg only — there is no browser
 * `fbq` AddToCart yet (that lands when the SDK's useCart auto-fires; the host's
 * <MetaPixel> bridge is already wired to forward it). So there is no browser
 * event to dedupe against here; the event_id is generated fresh.
 */

import type { NextRequest } from "next/server";
import { fetchStoreByHost } from "@/lib/api-client";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";
const TIMEOUT_MS = 3_000;

function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const m = cookieHeader.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

export async function fireServerCapi(
  req: NextRequest,
  step: string,
  stepData: Record<string, unknown> = {},
  opts: { eventId?: string } = {},
): Promise<void> {
  try {
    const host =
      req.headers.get("x-numu-host") ||
      (req.headers.get("host") || "").split(":")[0];
    if (!host) return;
    const store = await fetchStoreByHost(host).catch(() => null);
    if (!store?.id) return;

    const cookieHeader = req.headers.get("cookie");
    let path = "/";
    try {
      path = new URL(req.url).pathname;
    } catch {
      /* keep default */
    }
    const body = {
      path,
      step,
      step_data: stepData,
      event_id:
        opts.eventId ||
        (typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}`),
      fbp: readCookie(cookieHeader, "_fbp"),
      fbc: readCookie(cookieHeader, "_fbc"),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      await fetch(`${API_URL}/storefront/store/${store.id}/track`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cookieHeader ? { cookie: cookieHeader } : {}),
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    /* best-effort — a tracking miss must never affect the cart write */
  }
}
