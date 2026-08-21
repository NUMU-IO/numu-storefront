/**
 * Type definitions for the numu_attribution cookie envelope.
 *
 * Shape is identical to the backend AttributionSnapshot
 * (NUMU-api/src/core/entities/attribution.py) so a snapshot round-trips
 * cleanly between cookie → /track POST → /checkout POST →
 * orders.attribution JSONB column.
 *
 * Per research.md R-01:
 *   - `first_touch` is set ONCE on first inbound URL with UTMs, never overwritten
 *   - `last_touch` is overwritten every subsequent inbound URL with UTMs
 *   - `session_id` is a ULID-style identifier stable for the cookie's lifetime
 *
 * SEC-004 size caps mirror the backend's Pydantic max_length constraints.
 */

export const ATTRIBUTION_SCHEMA_VERSION = 1;

export interface AttributionTouch {
  ts: string;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_term: string | null;
  utm_content: string | null;
  gclid: string | null;
  fbclid: string | null;
  // TikTok's click id. Optional so envelopes written before it was captured
  // still parse; the API's `AttributionTouch` defaults it to null too.
  ttclid?: string | null;
  referrer: string | null;
  landing_path: string | null;
}

export interface AttributionSnapshot {
  v: number;
  first_touch: AttributionTouch;
  last_touch: AttributionTouch;
  session_id: string | null;
}

export const URL_ATTRIBUTION_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  // A TikTok ad click appends ONLY `ttclid` — no UTMs. Without it here a
  // TikTok landing created no touch at all, so `last_touch` kept whatever
  // came before (often a 90-day-old Meta click) and the whole session —
  // funnel rows, the order, the abandoned checkout, the `fbc` sent to CAPI
  // — was attributed to Meta.
  "ttclid",
] as const;

export type UrlAttributionKey = (typeof URL_ATTRIBUTION_KEYS)[number];
