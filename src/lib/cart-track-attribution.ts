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
 */

import { readCookie } from "./attribution-client";
import type { AttributionTouch } from "./attribution-types";
import { ensureTtclidCaptured } from "./tiktok-pixel";

export interface TrafficSource {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
}

/**
 * Click id → canonical platform slug. Mirrors `CLICK_ID_SOURCES` in the
 * API's `click_id_attribution.py`; the two must agree or the order and its
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
  } catch {
    /* attribution is best-effort — never block the tracking write */
  }
  return {};
}
