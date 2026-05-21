/**
 * Client-side helpers for the numu_attribution cookie.
 *
 * Pure read/write/merge functions. No React, no Next.js imports —
 * directly callable from BYOT theme bundles via the
 * `window.__numu_attribution` bridge installed by AttributionProvider.
 *
 * Cookie attributes (research.md R-01 + contracts/
 * storefront-attribution-api.md):
 *   - Name: numu_attribution
 *   - Value: URL-encoded JSON envelope
 *   - Path: /
 *   - Max-Age: 90 days
 *   - SameSite: Lax (survives the first nav from external campaign URL)
 *   - Secure: when served over HTTPS
 *   - HttpOnly: false (the storefront / theme reads it for checkout submit)
 *
 * Merge rule (FR-009 / R-01):
 *   - On every page load with UTMs in window.location.search → emit new touch.
 *   - first_touch is set ONCE and never overwritten.
 *   - last_touch is overwritten on every new touch.
 *   - session_id is set ONCE alongside first_touch.
 */

import {
  ATTRIBUTION_SCHEMA_VERSION,
  URL_ATTRIBUTION_KEYS,
  type AttributionSnapshot,
  type AttributionTouch,
  type UrlAttributionKey,
} from "./attribution-types";

const COOKIE_NAME = "numu_attribution";
const COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;
const COOKIE_PATH = "/";
const COOKIE_SAMESITE = "Lax";

const CAP_UTM = 200;
const CAP_REFERRER = 500;
const CAP_LANDING = 500;
const CAP_CLICK_ID = 256;
const CAP_SESSION_ID = 64;
const CAP_ENVELOPE_BYTES = 4096;

// ── Public surface ──────────────────────────────────────────────────

export function readCookie(): AttributionSnapshot | null {
  if (typeof document === "undefined") return null;
  const raw = readCookieRaw(COOKIE_NAME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    if (!isSnapshot(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCookie(envelope: AttributionSnapshot): void {
  if (typeof document === "undefined") return;
  const value = encodeURIComponent(JSON.stringify(envelope));
  if (new Blob([value]).size > CAP_ENVELOPE_BYTES) return;
  const isHttps =
    typeof window !== "undefined" && window.location.protocol === "https:";
  const parts = [
    `${COOKIE_NAME}=${value}`,
    `Path=${COOKIE_PATH}`,
    `Max-Age=${COOKIE_MAX_AGE_SECONDS}`,
    `SameSite=${COOKIE_SAMESITE}`,
  ];
  if (isHttps) parts.push("Secure");
  document.cookie = parts.join("; ");
}

export function parseUrlForUtms(search: string): {
  [K in UrlAttributionKey]: string | null;
} | null {
  const params = new URLSearchParams(search);
  let hasAny = false;
  const out = {} as { [K in UrlAttributionKey]: string | null };
  for (const key of URL_ATTRIBUTION_KEYS) {
    const value = params.get(key);
    if (value != null && value !== "") {
      hasAny = true;
      out[key] = value;
    } else {
      out[key] = null;
    }
  }
  return hasAny ? out : null;
}

export function composeTouchFromUrl(args: {
  search: string;
  referrer: string;
  landingPath: string;
  now?: Date;
}): AttributionTouch | null {
  const parsed = parseUrlForUtms(args.search);
  if (!parsed) return null;
  return {
    ts: (args.now ?? new Date()).toISOString(),
    utm_source: truncOrNull(parsed.utm_source, CAP_UTM),
    utm_medium: truncOrNull(parsed.utm_medium, CAP_UTM),
    utm_campaign: truncOrNull(parsed.utm_campaign, CAP_UTM),
    utm_term: truncOrNull(parsed.utm_term, CAP_UTM),
    utm_content: truncOrNull(parsed.utm_content, CAP_UTM),
    gclid: truncOrNull(parsed.gclid, CAP_CLICK_ID),
    fbclid: truncOrNull(parsed.fbclid, CAP_CLICK_ID),
    referrer: truncOrNull(args.referrer, CAP_REFERRER),
    landing_path: truncOrNull(args.landingPath, CAP_LANDING),
  };
}

export function mergeTouch(
  existing: AttributionSnapshot | null,
  next: AttributionTouch,
  sessionIdGenerator: () => string = generateSessionId,
): AttributionSnapshot {
  if (existing == null) {
    return {
      v: ATTRIBUTION_SCHEMA_VERSION,
      first_touch: next,
      last_touch: next,
      session_id: truncOrNull(sessionIdGenerator(), CAP_SESSION_ID),
    };
  }
  return {
    v: ATTRIBUTION_SCHEMA_VERSION,
    first_touch: existing.first_touch,
    last_touch: next,
    session_id: existing.session_id,
  };
}

export function captureAndPersist(args: {
  search: string;
  referrer: string;
  landingPath: string;
  now?: Date;
  sessionIdGenerator?: () => string;
}): AttributionSnapshot | null {
  if (typeof document === "undefined") return null;
  const existing = readCookie();
  const touch = composeTouchFromUrl(args);
  if (touch == null) return existing;
  const merged = mergeTouch(existing, touch, args.sessionIdGenerator);
  writeCookie(merged);
  return merged;
}

export function clearCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${COOKIE_NAME}=; Path=${COOKIE_PATH}; Max-Age=0; SameSite=Lax`;
}

// ── Internals ────────────────────────────────────────────────────────

function truncOrNull(value: string | null, max: number): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function readCookieRaw(name: string): string | null {
  if (typeof document === "undefined") return null;
  const all = document.cookie || "";
  if (!all) return null;
  const prefix = `${name}=`;
  for (const chunk of all.split(";")) {
    const c = chunk.trim();
    if (c.startsWith(prefix)) {
      return c.slice(prefix.length);
    }
  }
  return null;
}

function isSnapshot(value: unknown): value is AttributionSnapshot {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.v !== ATTRIBUTION_SCHEMA_VERSION) return false;
  if (!isTouch(v.first_touch)) return false;
  if (!isTouch(v.last_touch)) return false;
  if (v.session_id !== null && typeof v.session_id !== "string") return false;
  return true;
}

function isTouch(value: unknown): value is AttributionTouch {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return typeof t.ts === "string";
}

export function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  let out = "";
  let bits = 0;
  let buf = 0;
  for (const b of bytes) {
    buf = (buf << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += alphabet[(buf >> bits) & 31];
    }
  }
  if (bits > 0) {
    out += alphabet[(buf << (5 - bits)) & 31];
  }
  return out.slice(0, 26);
}
