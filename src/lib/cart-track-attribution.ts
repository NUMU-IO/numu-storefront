/**
 * Traffic-source resolution for the abandoned-checkout cart-track payload.
 *
 * The backend's `cart/track` endpoint accepts utm_source/medium/campaign
 * and the merchant's Abandoned Checkouts page displays them — but only
 * shoppers arriving from merchant-tagged links carry explicit UTMs. Ad
 * platforms, however, ALWAYS append their click ids to ad clicks
 * (`ttclid` for TikTok, `fbclid` for Meta, `gclid` for Google), so when
 * no utm_source was captured we derive the platform from the click id.
 * Derived sources use the canonical platform slug and utm_medium "paid"
 * so they are distinguishable from merchant-tagged traffic.
 *
 * Last-touch wins (same rule as the attribution envelope). Each touch is a
 * snapshot of ONE landing URL, so whichever click id it carries IS that
 * touch's platform — there is no cross-touch precedence. This used to check
 * `fbclid` on the last AND first touch before ever looking at `ttclid`, and
 * `ttclid` was not part of the envelope, so a shopper with any Meta click in
 * the last 90 days who then arrived from a TikTok ad was shown as Meta.
 *
 * The bare `ttclid` cookie remains a final fallback for envelopes written
 * before `ttclid` was captured into them.
 *
 * Past the click ids, `traffic-source.ts` continues the chain with the
 * in-app browser's User-Agent and the referrer host — the only signals an
 * untagged organic visit has. TikTok needs the User-Agent specifically:
 * its webview sends no referrer at all, so every TikTok visit was being
 * written as "Direct".
 */

import { readCookie } from "./attribution-client";
import type { AttributionTouch } from "./attribution-types";
import { ensureTtclidCaptured } from "./tiktok-pixel";
import { deriveSourceFromEnvironment } from "./traffic-source";

export interface TrafficSource {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}

/**
 * Click id → canonical platform slug. Mirrors `CLICK_ID_SOURCES` in the
 * API's `traffic_source.py`; the two must agree or the order and its
 * abandoned-checkout twin would name the same visit differently.
 */
const CLICK_ID_SOURCES: ReadonlyArray<
  readonly [keyof AttributionTouch, string]
> = [
  ["ttclid", "tiktok"],
  ["fbclid", "facebook"],
  ["gclid", "google"],
];

export function deriveSourceFromClickIds(
  touch: AttributionTouch | null | undefined,
): string | null {
  if (!touch) return null;
  for (const [key, source] of CLICK_ID_SOURCES) {
    const v = touch[key];
    if (typeof v === "string" && v.trim()) return source;
  }
  return null;
}

function fromTouch(
  touch: AttributionTouch | null | undefined,
): TrafficSource | null {
  if (!touch) return null;
  if (touch.utm_source) {
    return {
      utm_source: touch.utm_source,
      utm_medium: touch.utm_medium ?? undefined,
      utm_campaign: touch.utm_campaign ?? undefined,
    };
  }
  const derived = deriveSourceFromClickIds(touch);
  if (!derived) return null;
  return {
    utm_source: derived,
    utm_medium: touch.utm_medium ?? "paid",
    utm_campaign: touch.utm_campaign ?? undefined,
  };
}

export function resolveTrafficSource(): TrafficSource {
  try {
    const snapshot = readCookie();
    const source =
      fromTouch(snapshot?.last_touch) ?? fromTouch(snapshot?.first_touch);
    if (source) return source;
    if (ensureTtclidCaptured()) {
      return { utm_source: "tiktok", utm_medium: "paid" };
    }
    // No UTMs and no click id anywhere — the untagged-organic case, which
    // is most of the traffic. The environment is all that is left: the
    // in-app browser first, then the referrer that brought them in.
    const derived = deriveSourceFromEnvironment({
      referrer: environmentReferrer(snapshot?.first_touch),
    });
    if (derived) {
      return { utm_source: derived.source, utm_medium: derived.medium };
    }
  } catch {
    /* attribution is best-effort — never block the tracking write */
  }
  return {};
}

/**
 * The referrer that started the visit, not the one on the current page.
 *
 * `document.referrer` is the store's own last page by the time a shopper
 * reaches the cart, which derives nothing (the table is an allowlist of
 * external platforms). The landing referrer recorded on the first touch is
 * the one that identifies where they actually came from; fall back to the
 * live value only when no envelope exists yet.
 */
function environmentReferrer(
  firstTouch: AttributionTouch | null | undefined,
): string | null {
  const landing = firstTouch?.referrer;
  if (typeof landing === "string" && landing.trim()) return landing;
  return typeof document !== "undefined" ? document.referrer || null : null;
}
