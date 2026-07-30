/**
 * Cookie-consent enforcement for the tracking pixels.
 *
 * The gap this closes: the merchant-facing `consent_required` toggle (and the
 * granular `consent_settings` behind it) was saved by the hub and correctly
 * plumbed server-side — `opt_out` → Meta, `limited_data_use` → TikTok — but
 * the storefront never actually gated anything on it. `<MetaPixel>` and
 * `<TikTokPixel>` mounted purely on "a pixel is configured", so the setting
 * was a no-op. Every MENA store has it off today, which is why nothing was
 * visibly wrong, but shipping that to EU/UK traffic would have been a
 * compliance problem dressed as a feature.
 *
 * Model (Shopify's Customer Privacy behaviour):
 *   * `consent_required = false` — the default, and every live store today.
 *     Behaviour is byte-identical to before this file existed.
 *   * `consent_required = true`, consent GRANTED — pixels mount, events send
 *     normally.
 *   * `consent_required = true`, consent DENIED or not yet given — the browser
 *     pixel does NOT mount (so no `_fbp`/`_ttp` cookies are written), and
 *     server-side events still go out carrying `opt_out: true`. That is not a
 *     loophole: it is Meta's documented mechanism for modeled conversions —
 *     attribution math only, no first-party data retained on their side. Going
 *     fully dark instead would silently destroy the merchant's reporting.
 *
 * Deliberate decision about the no-surface case: if a merchant turns
 * `consent_required` on but has no cookie-banner promotion configured, no
 * visitor can ever grant consent. Rather than leave that store with zero
 * tracking forever and no clue why, we treat it as permanent "not granted" —
 * i.e. opt-out'd server events, no browser pixel. Conservative on privacy,
 * and it still reports conversions.
 */

export type ConsentDecision = "accepted" | "rejected" | null;

/** Fired on `window` when the visitor decides, so gates re-evaluate live. */
export const CONSENT_CHANGED_EVENT = "numu:consent-changed";

/** localStorage key written by `<CookieBanner>`. */
const CONSENT_KEY = "numu_cookie_consent_v1";

export interface StoreConsentPolicy {
  /** Merchant requires consent before marketing pixels may run. */
  required: boolean;
  /** Banner shows 4 per-category toggles rather than one Accept/Reject pair. */
  granular: boolean;
  /** Whether a consent surface actually exists for the visitor to act on. */
  hasSurface: boolean;
}

/**
 * Read the merchant's consent policy off the store settings blob.
 *
 * Takes `unknown` and narrows defensively — the host's StoreData type doesn't
 * declare `settings`, but the backend sends the full JSON at runtime. Same
 * approach as `resolveMetaPixelIds`.
 */
export function resolveConsentPolicy(
  store: unknown,
  hasSurface: boolean,
): StoreConsentPolicy {
  const settings =
    store && typeof store === "object"
      ? (store as Record<string, unknown>).settings
      : undefined;
  const tracking =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>).tracking
      : undefined;

  // Either channel asking for consent is enough to require it — a shopper
  // can't meaningfully consent to Meta but not TikTok through one banner.
  let required = false;
  let granular = false;
  for (const channel of ["meta", "tiktok"] as const) {
    const cfg =
      tracking && typeof tracking === "object"
        ? (tracking as Record<string, unknown>)[channel]
        : undefined;
    if (!cfg || typeof cfg !== "object") continue;
    const c = cfg as Record<string, unknown>;
    if (c.consent_required === true) required = true;
    const cs = c.consent_settings;
    if (cs && typeof cs === "object") {
      if ((cs as Record<string, unknown>).granular_enabled === true) {
        granular = true;
      }
    }
  }
  return { required, granular, hasSurface };
}

/** The visitor's stored decision, or null if they haven't chosen. */
export function readVisitorConsent(): ConsentDecision {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { decision?: unknown };
    return parsed.decision === "accepted"
      ? "accepted"
      : parsed.decision === "rejected"
        ? "rejected"
        : null;
  } catch {
    return null;
  }
}

// The policy has to be readable from plain functions with no React context —
// `postTrack` in meta-pixel.ts is called from imperative code all over the
// checkout. `<ConsentGate>` publishes it here on mount, matching how
// AttributionProvider and the customer bridge already expose their state.
interface ConsentWindow {
  __numu_consent?: StoreConsentPolicy;
}

export function publishConsentPolicy(policy: StoreConsentPolicy): void {
  if (typeof window === "undefined") return;
  (window as unknown as ConsentWindow).__numu_consent = policy;
}

function readPublishedPolicy(): StoreConsentPolicy | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as ConsentWindow).__numu_consent;
}

/** May the browser pixel run? */
export function browserPixelAllowed(
  policy: StoreConsentPolicy,
  decision: ConsentDecision,
): boolean {
  if (!policy.required) return true;
  return decision === "accepted";
}

/**
 * Should this event carry `opt_out: true`?
 *
 * Returns `undefined` — not `false` — when consent isn't required, so the
 * field is omitted from the payload entirely and the request stays identical
 * to what a pre-consent client sent.
 */
export function trackingOptOut(): true | undefined {
  const policy = readPublishedPolicy();
  if (!policy?.required) return undefined;
  return readVisitorConsent() === "accepted" ? undefined : true;
}
