/**
 * Traffic-source resolution for the abandoned-checkout cart-track payload.
 *
 * The backend's `cart/track` endpoint accepts utm_source/medium/campaign
 * and the merchant's Abandoned Checkouts page displays them — but only
 * shoppers arriving from merchant-tagged links carry explicit UTMs. Ad
 * platforms, however, ALWAYS append their click ids to ad clicks
 * (`fbclid` for Meta, `ttclid` for TikTok, `gclid` for Google), so when
 * no utm_source was captured we derive the platform from the click id.
 * Derived sources use the canonical platform slug and utm_medium "paid"
 * so they are distinguishable from merchant-tagged traffic.
 *
 * Last-touch wins (same rule as the attribution envelope). `ttclid`
 * lives outside the numu_attribution cookie (it is not part of the
 * backend attribution contract), so it acts as the final fallback.
 */

import { readCookie } from "./attribution-client";
import type { AttributionTouch } from "./attribution-types";
import { ensureTtclidCaptured } from "./tiktok-pixel";

export interface TrafficSource {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
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
  const derived = touch.fbclid ? "facebook" : touch.gclid ? "google" : null;
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
