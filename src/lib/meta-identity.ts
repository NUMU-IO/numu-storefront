/**
 * Shopper identity for browser-side Advanced Matching.
 *
 * ## The gap this closes
 *
 * `MetaPixel` initialised every pixel as `fbq('init','<id>')` with no second
 * argument, so the browser half of every deduplicated event pair carried
 * exactly zero customer information — not even `external_id`, which the server
 * leg already sends on 100% of events. Measured against the live Vionne
 * dataset, `AddToCart` and `InitiateCheckout` had *perfect* coverage on all
 * five non-PII keys (ip, user_agent, fbp, fbc, external_id) and still scored
 * 6.1/10, because Meta had no hashed PII to match on. 6.1 is the ceiling of a
 * PII-free implementation; only this unlocks the range above it.
 *
 * ## Why a module closure and not storage
 *
 * BYOT theme bundles execute on the storefront's own origin. Anything in
 * `localStorage` / `sessionStorage` is readable by any theme a merchant
 * installs, so a shopper's email must never go there — the same reasoning the
 * backend's `_enrich_user_data_from_session` documents for keeping guest
 * identity server-side. A module-level variable dies with the document, which
 * is the correct lifetime: each page load re-learns identity from the checkout
 * form, or does without it.
 *
 * ## Raw, not hashed
 *
 * Meta's browser SDK normalises and SHA-256-hashes Advanced Matching values
 * itself before they leave the device, so we pass raw values here. Hashing
 * them ourselves would double-hash and match nothing. The CAPI leg is the
 * opposite — `hash_user_data()` on the server owns that contract.
 */

import { composePhone } from "@/lib/phone";

export interface ShopperIdentity {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  state?: string;
  zip?: string;
  /** ISO-3166-1 alpha-2, or whatever the checkout collected. */
  country?: string;
}

type FbqFn = (...args: unknown[]) => void;
type TtqIdentify = { identify?: (data: Record<string, string>) => void };

interface IdentityWindow extends Window {
  fbq?: FbqFn;
  ttq?: TtqIdentify;
  __numuPixelIds?: string[];
  __numuTikTokPixelIds?: string[];
}

function w(): IdentityWindow | null {
  return typeof window === "undefined" ? null : (window as IdentityWindow);
}

/** Document-scoped. Deliberately not persisted — see the module docstring. */
let identity: ShopperIdentity = {};

function clean(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Placeholder addresses NUMU mints for guests — hashing one matches nothing. */
function isRealEmail(email: string | undefined): boolean {
  if (!email || !email.includes("@")) return false;
  const lower = email.toLowerCase();
  return !(
    lower.includes("@noemail.") ||
    lower.includes("@guest.") ||
    lower.includes("@placeholder.") ||
    lower.endsWith("@example.com")
  );
}

/** Merge in whatever the shopper has just given us. Later wins, blanks ignored. */
export function setShopperIdentity(next: ShopperIdentity): void {
  const merged: ShopperIdentity = { ...identity };
  for (const [key, value] of Object.entries(next) as [
    keyof ShopperIdentity,
    string | undefined,
  ][]) {
    const v = clean(value);
    if (v) merged[key] = v;
  }
  if (merged.email && !isRealEmail(merged.email)) delete merged.email;
  identity = merged;
}

export function getShopperIdentity(): ShopperIdentity {
  return identity;
}

export function hasShopperIdentity(): boolean {
  return Object.keys(identity).length > 0;
}

/**
 * `user_data` for the CAPI leg — NUMU's own server-side vocabulary.
 *
 * Sent raw over HTTPS to our own origin; `hash_user_data()` on the API applies
 * Meta's per-field normalisation and hashing. The backend allowlists exactly
 * these keys (`_client_supplied_user_data`), so anything else added here is
 * dropped server-side rather than silently trusted.
 */
export function identityForCapi(): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  const map: Array<[keyof ShopperIdentity, string]> = [
    ["email", "email"],
    ["phone", "phone"],
    ["firstName", "first_name"],
    ["lastName", "last_name"],
    ["city", "city"],
    ["state", "state"],
    ["zip", "zip"],
    ["country", "country_code"],
  ];
  for (const [from, to] of map) {
    const v = identity[from];
    if (v) out[to] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Meta's Advanced Matching object — their key names, raw values. */
function advancedMatchingObject(externalId?: string): Record<string, string> {
  const am: Record<string, string> = {};
  if (identity.email) am.em = identity.email.toLowerCase();
  if (identity.phone) am.ph = identity.phone;
  if (identity.firstName) am.fn = identity.firstName;
  if (identity.lastName) am.ln = identity.lastName;
  if (identity.city) am.ct = identity.city;
  if (identity.state) am.st = identity.state;
  if (identity.zip) am.zp = identity.zip;
  if (identity.country) am.country = identity.country;
  if (externalId) am.external_id = externalId;
  return am;
}

/**
 * The `ttq.identify` payload. Raw values — TikTok's SDK hashes on-device —
 * but the phone must already be E.164 WITH the "+": the SDK hashes exactly
 * what it is given, so a national "010…" would be a digest of nothing.
 * `country` is the ISO-2 the checkout collected; Egypt is the default dial.
 */
export function tiktokIdentifyPayload(
  externalId?: string,
): Record<string, string> {
  const tt: Record<string, string> = {};
  if (identity.email) tt.email = identity.email.toLowerCase();
  if (identity.phone) {
    tt.phone_number = composePhone(identity.country || "EG", identity.phone);
  }
  if (externalId) tt.external_id = externalId;
  return tt;
}

/**
 * Re-initialise every configured pixel with Advanced Matching.
 *
 * Meta supports calling `fbq('init', id, userData)` again to attach matching
 * parameters to subsequent events; the pixel is not duplicated. Events already
 * sent are untouched — the backend's identity-enrichment resend
 * (`refireFunnelWithIdentity`) is what upgrades those.
 *
 * `externalId` is passed even with no PII at all: it is free, it is the same
 * pseudonymous session id the server sends, and having both legs agree on one
 * identifier is what lets Meta stitch a guest's journey together.
 */
export function applyAdvancedMatching(externalId?: string): void {
  const win = w();
  if (!win) return;

  const am = advancedMatchingObject(externalId);
  if (Object.keys(am).length === 0) return;

  const fbq = win.fbq;
  if (typeof fbq === "function") {
    for (const id of win.__numuPixelIds ?? []) {
      try {
        fbq("init", id, am);
      } catch {
        /* a misbehaving pixel must never break checkout */
      }
    }
  }

  // TikTok carries the identical hole and the identical fix. `ttq.identify`
  // takes raw values and hashes them client-side, same contract as Meta's AM.
  try {
    const identify = win.ttq?.identify;
    if (typeof identify === "function") {
      const tt = tiktokIdentifyPayload(externalId);
      if (Object.keys(tt).length > 0) identify(tt);
    }
  } catch {
    /* optional channel */
  }
}

/** Convenience: record identity and immediately attach it to the pixels. */
export function identifyShopper(
  next: ShopperIdentity,
  externalId?: string,
): void {
  setShopperIdentity(next);
  applyAdvancedMatching(externalId);
}
