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

/**
 * The visitor's session id, read out of the `numu_attribution` cookie —
 * the same value `getSessionFingerprint()` returns in the browser, so
 * server-fired and browser-fired events agree on one session identity.
 * Best-effort: a malformed cookie yields undefined rather than throwing.
 */
function readSessionId(cookieHeader: string | null): string | undefined {
  const raw = readCookie(cookieHeader, "numu_attribution");
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { session_id?: unknown };
    return typeof parsed.session_id === "string" && parsed.session_id
      ? parsed.session_id
      : undefined;
  } catch {
    return undefined;
  }
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
      // Session id from the attribution cookie. The backend maps this to the
      // pseudonymous `external_id` match key, so an anonymous AddToCart still
      // carries an identifier that ties it to the rest of the session (and to
      // the eventual Purchase). Browser-fired events send the same value as
      // `fingerprint`; this is the server-route equivalent.
      fingerprint: readSessionId(cookieHeader),
      ttclid: readCookie(cookieHeader, "ttclid"),
      ttp: readCookie(cookieHeader, "_ttp"),
    };

    // Forward the shopper's IP + UA. This is a server-to-server fetch, so
    // none of their headers travel automatically and the backend would
    // otherwise attribute the event to this server's own address — the same
    // defect the /api/storefront/track proxy had.
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    };
    const chain = (req.headers.get("x-forwarded-for") || "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const edgeIp =
      req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip");
    if (edgeIp && !chain.includes(edgeIp)) chain.push(edgeIp);
    if (chain.length) headers["X-Forwarded-For"] = chain.join(", ");
    const ua = req.headers.get("user-agent");
    if (ua) headers["User-Agent"] = ua;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      await fetch(`${API_URL}/storefront/store/${store.id}/track`, {
        method: "POST",
        headers,
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
