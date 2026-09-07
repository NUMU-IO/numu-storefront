/**
 * Meta Pixel (browser) + Conversions-API bridge for the V3 storefront host.
 *
 * Why this lives in the host (not a theme or the SDK):
 *   The V3 host renders the shell around EVERY theme (built-in or BYOT) and
 *   owns the entire checkout, so the whole Meta funnel can be fired from one
 *   place without any per-theme code. The browser Pixel sets the `_fbp` /
 *   `_fbc` cookies; the existing `/api/storefront/track` proxy reads those
 *   cookies server-side and forwards a hashed CAPI event to the backend
 *   (`/storefront/store/{id}/track` → meta_capi). Browser + CAPI fires share
 *   ONE `event_id` so Meta's Events Manager dedupes the pair.
 *
 * Units: values are sent to Meta in MAJOR currency units (e.g. 99.99) — the
 * same convention as the V2 storefront and what Meta expects. NOT cents.
 *
 * Everything here is isomorphic: `resolveMetaPixelIds` is pure (safe to call
 * in a Server Component to decide whether to mount <MetaPixel>); the dispatch
 * helpers guard on `typeof window` and no-op during SSR.
 */

import { FUNNEL_STEP_TO_TIKTOK, ttqTrack } from "./tiktok-pixel";
import { trackingOptOut } from "./consent";
import { identityForCapi } from "./meta-identity";

// ── Store config → enabled pixel IDs ────────────────────────────────────────

interface PixelEntry {
  pixel_id?: string;
  pixel_enabled?: boolean;
}
interface MetaSettings {
  pixel_id?: string;
  pixel_enabled?: boolean;
  pixels?: PixelEntry[];
}
const PIXEL_ID_RE = /^\d{6,20}$/;

/**
 * Resolve the store's enabled Meta Pixel IDs.
 *
 * Precedence (first non-empty wins):
 *   1. multi-pixel array `settings.tracking.meta.pixels[]` (entries with
 *      `pixel_enabled !== false`),
 *   2. single `settings.tracking.meta.pixel_id` (modern Tracking panel),
 *   3. legacy top-level `settings.meta_pixel_id` — the field the hub's
 *      Online Store → Preferences page still writes. Merchants who configured
 *      their pixel THERE (and never opened Settings → Tracking) would otherwise
 *      get NO pixel on the V3 storefront, since the two hub surfaces write
 *      different keys and only the modern one was read. This last-resort
 *      fallback closes that gap; it can only ADD an id when nothing modern is
 *      configured, never override an explicit Tracking-panel value.
 *
 * Validates the 6–20 digit numeric shape and de-dupes. Returns `[]` when
 * nothing valid is configured — the caller then skips mounting the Pixel.
 */
// Accepts `unknown` — the host passes its StoreData, whose type doesn't
// declare `settings`; we narrow defensively (the backend sends the full
// settings JSON blob with `tracking.meta` on it at runtime).
export function resolveMetaPixelIds(store: unknown): string[] {
  const settings =
    store && typeof store === "object"
      ? (store as Record<string, unknown>).settings
      : undefined;
  const tracking =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>).tracking
      : undefined;
  const metaRaw =
    tracking && typeof tracking === "object"
      ? (tracking as Record<string, unknown>).meta
      : undefined;
  const meta: MetaSettings =
    metaRaw && typeof metaRaw === "object" ? (metaRaw as MetaSettings) : {};
  const valid = (id: unknown): id is string =>
    typeof id === "string" && PIXEL_ID_RE.test(id.trim());

  // Top-level kill switch, honoured BEFORE `pixels[]`.
  //
  // `pixels[]` was resolved first and the top-level flags ignored entirely,
  // so a multi-pixel store that hit "Disconnect" in the hub kept firing on
  // every page — the merchant believed they had stopped sending data to Meta
  // and had not. The API now also disables each array entry, but this is the
  // backstop that protects stores whose settings were written before that
  // fix, including any still sitting in an ISR cache.
  if (meta.pixel_enabled === false) return [];

  const ids: string[] = [];
  if (Array.isArray(meta.pixels)) {
    for (const p of meta.pixels) {
      if (p && p.pixel_enabled !== false && valid(p.pixel_id)) {
        ids.push(p.pixel_id.trim());
      }
    }
  }
  // No `pixel_enabled !== false` guard here — the kill switch above already
  // returned for that case, so repeating it is dead code.
  if (ids.length === 0 && valid(meta.pixel_id)) {
    ids.push(meta.pixel_id.trim());
  }
  // Legacy fallback — the flat `settings.meta_pixel_id` written by the hub's
  // Online Store → Preferences page (no enable toggle there, so a present
  // valid id is treated as on).
  if (ids.length === 0 && settings && typeof settings === "object") {
    const legacy = (settings as Record<string, unknown>).meta_pixel_id;
    if (valid(legacy)) ids.push(legacy.trim());
  }
  return Array.from(new Set(ids));
}

// ── Event maps ──────────────────────────────────────────────────────────────

/**
 * Backend funnel-step → Meta standard-event name. The host trackers speak in
 * funnel-step names (the same vocabulary the backend's funnel_events table and
 * meta_capi mapping use); this turns them into the browser `fbq` event name.
 */
export const FUNNEL_STEP_TO_META: Record<string, string> = {
  page_view: "PageView",
  product_view: "ViewContent",
  add_to_cart: "AddToCart",
  checkout_started: "InitiateCheckout",
  // Custom event, not a Meta standard one — deliberate. The shipping step is
  // where the full address lands, and a custom event still carries complete
  // `user_data` and still counts toward the dataset's match quality. Must stay
  // in step with `FUNNEL_STEP_TO_META_EVENT` in the API's meta_capi task.
  add_shipping_info: "AddShippingInfo",
  add_payment_info: "AddPaymentInfo",
  order_completed: "Purchase",
  search: "Search",
  lead: "Lead",
  complete_registration: "CompleteRegistration",
  add_to_wishlist: "AddToWishlist",
};

/**
 * SDK / theme `useAnalytics().track()` event name → funnel step. Mirrors the
 * SDK's own EVENT_TO_FUNNEL_STEP so the <MetaPixel> bridge can fire a browser
 * event for anything a theme dispatches via `numu:analytics:event`.
 */
export const EVENT_NAME_TO_FUNNEL_STEP: Record<string, string> = {
  page_view: "page_view",
  view_item: "product_view",
  view_collection: "page_view",
  add_to_cart: "add_to_cart",
  begin_checkout: "checkout_started",
  add_payment_info: "add_payment_info",
  purchase: "order_completed",
  search: "search",
  lead: "lead",
  sign_up: "complete_registration",
  add_to_wishlist: "add_to_wishlist",
};

// ── Browser-side window bridges (shared with the SDK) ────────────────────────
//
// The host's AttributionProvider + CustomerBridgeProvider install these same
// globals that the SDK's useAnalytics reads, so host-fired and theme-fired
// events agree on session/identity. We read them the exact same way.

interface AttributionEnvelope {
  session_id?: string | null;
  [k: string]: unknown;
}
interface FbqWindow {
  fbq?: (...args: unknown[]) => void;
  __numu_attribution?: { get(): AttributionEnvelope | null };
  __numu_customer?: { getId(): string | null };
  __numu_session_fp?: string;
  __numu_pv?: { path: string; id: string };
}

function w(): FbqWindow | null {
  return typeof window === "undefined" ? null : (window as unknown as FbqWindow);
}

function readAttribution(): AttributionEnvelope | null {
  try {
    return w()?.__numu_attribution?.get?.() ?? null;
  } catch {
    return null;
  }
}

function readCustomerId(): string | null {
  try {
    return w()?.__numu_customer?.getId?.() ?? null;
  } catch {
    return null;
  }
}

/** Name of the first-party visitor cookie — see `persistSessionId`. */
export const SESSION_COOKIE = "numu_sid";

/** 180 days — long enough that a returning shopper keeps one `external_id`. */
const VISITOR_COOKIE_MAX_AGE = 180 * 24 * 60 * 60;

/**
 * Mirror the session id into a cookie the SERVER can read.
 *
 * Why this exists: `add_to_cart` is the only funnel step emitted server-side
 * (theme → SDK `addItem` → POST /api/cart/add → fireServerCapi). That route
 * has no access to `window`, so it read the session id out of the
 * `numu_attribution` cookie — which `captureAndPersist` only writes when the
 * landing URL carried a UTM / gclid / fbclid. For direct, organic and
 * social-referral shoppers no cookie existed, so the funnel row was written
 * with `session_fingerprint = NULL`, and `COUNT(DISTINCT session_fingerprint)`
 * drops NULLs — the add-to-cart bar counted ONLY ad-click sessions while every
 * other bar counted all sessions. A real store reported Checkout (11) above
 * Add to Cart (4), with cart abandonment rendering as -175%.
 *
 * Writing the id we already computed into its own cookie closes the gap for
 * every visitor without touching attribution semantics. (Always writing
 * `numu_attribution` instead would make a direct visit the `first_touch` and
 * silently rewrite attribution history for every store.)
 *
 * Not HttpOnly: same trust level as `numu_attribution`, and the browser half
 * of the tracking stack reads it too. It is a random per-session id, not PII.
 */
function persistSessionId(fp: string): void {
  if (typeof document === "undefined" || !fp || fp === "ssr") return;
  try {
    if (new RegExp(`(?:^|; )${SESSION_COOKIE}=`).test(document.cookie)) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    // Persistent (180 days), not session-scoped.
    //
    // This id is sent to Meta and TikTok as `external_id` — a match key whose
    // entire value is being STABLE for one person. Session-scoping it meant a
    // returning shopper minted a fresh id every visit, so the ad platforms saw
    // N strangers rather than one returning customer, and no amount of
    // coverage on that key could compensate. Only visitors who happened to
    // arrive through a tagged ad URL got a durable id (via the 90-day
    // `numu_attribution` cookie) — exactly backwards, since those are the
    // visitors Meta can already identify.
    //
    // Per-VISIT analytics are unaffected: funnel/session reports key on the
    // rows' own timestamps, not on this cookie's lifetime.
    document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(fp)}; Path=/; Max-Age=${VISITOR_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
  } catch {
    /* private mode / disabled cookies — server leg falls back to no id */
  }
}

/** Read back the session id this visit already established, if any. */
function readSessionCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  try {
    const m = document.cookie.match(
      new RegExp(`(?:^|; )${SESSION_COOKIE}=([^;]*)`),
    );
    return m ? decodeURIComponent(m[1]) || undefined : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Stable per-session fingerprint, identical strategy to the SDK. Exported so
 * other host surfaces (e.g. abandoned-cart tracking) share the same session id.
 *
 * Resolution order matters. `__numu_session_fp` is a per-DOCUMENT global, so it
 * dies on every full page load; the cookie is read BEFORE minting a new id so a
 * reload, a new tab, or any non-soft navigation keeps the same session.
 *
 * Without that cookie read this function would mint a fresh uuid on load 2
 * while `persistSessionId` (write-once) kept serving load 1's id to the server.
 * The browser-fired steps and the server-fired `add_to_cart` would then land on
 * two different session ids — no longer NULL, but still unjoinable, which drives
 * cart abandonment to 100% instead of -175%. Same bug wearing a different hat.
 */
export function getSessionFingerprint(): string {
  const win = w();
  if (!win) return "ssr";
  const sid = readAttribution()?.session_id;
  if (sid) {
    persistSessionId(sid);
    return sid;
  }
  if (win.__numu_session_fp) {
    persistSessionId(win.__numu_session_fp);
    return win.__numu_session_fp;
  }
  const fromCookie = readSessionCookie();
  if (fromCookie) {
    win.__numu_session_fp = fromCookie;
    return fromCookie;
  }
  const fp = crypto.randomUUID();
  win.__numu_session_fp = fp;
  persistSessionId(fp);
  return fp;
}

export function getEventId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

/**
 * ONE PageView event_id per navigation, shared between the browser fbq
 * PageView (<MetaPixel>: inline snippet + route-change effect) and the
 * first-party /track POST (<PageViewTracker>). Without a shared id the
 * backend's CAPI PageView can't dedupe against the browser PageView, so
 * enabling CAPI would double-count every page view in Events Manager.
 *
 * The inline snippet seeds `window.__numu_pv` when it fires the initial
 * PageView; on soft navigations whichever effect runs first mints the id
 * for that pathname and the other reuses it.
 */
export function pageViewEventId(path: string): string {
  const win = w();
  if (!win) return getEventId();
  if (win.__numu_pv?.path === path) return win.__numu_pv.id;
  const id = getEventId();
  win.__numu_pv = { path, id };
  return id;
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

function cleanData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    // `tiktok_*` keys are addressed to the TikTok mapper only (see
    // `toTikTokProps`); Meta and the /track proxy must never see them.
    if (k.startsWith("tiktok_")) continue;
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}

/** Fire a browser Pixel event to all initialized pixels (no-op if absent). */
export function fbqTrack(
  metaEvent: string,
  data: Record<string, unknown> = {},
  eventId?: string,
): void {
  const fbq = w()?.fbq;
  if (typeof fbq !== "function") return;
  try {
    fbq(
      "track",
      metaEvent,
      cleanData(data),
      eventId ? { eventID: eventId } : undefined,
    );
  } catch {
    /* a misbehaving pixel must never break the page */
  }
}

/**
 * Events Meta cannot use without a value. Only `Purchase` is gated: an
 * `AddToCart` with no value is still a useful signal, a `Purchase` with no
 * value is a conversion Meta refuses to count and reports as "0% valid value".
 */
const VALUE_REQUIRED_EVENTS = new Set(["Purchase"]);

/**
 * Reason this payload must not be fired browser-side, or null if it is fine.
 *
 * Zero is deliberately allowed: a fully-discounted or gift-carded order is a
 * real conversion, and suppressing it would trade a reporting blemish for a
 * missing sale. Same rule as the API's `validate_conversion_value`.
 */
function conversionValueDefect(
  metaEvent: string,
  data: Record<string, unknown>,
): string | null {
  if (!VALUE_REQUIRED_EVENTS.has(metaEvent)) return null;

  const rawValue = data.value;
  if (rawValue === undefined || rawValue === null) return "missing_value";
  const value = typeof rawValue === "number" ? rawValue : Number(rawValue);
  if (!Number.isFinite(value)) return `non_numeric_value:${String(rawValue)}`;
  if (value < 0) return `negative_value:${value}`;

  const currency = data.currency;
  if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency.trim())) {
    return `invalid_currency:${String(currency)}`;
  }
  return null;
}

/**
 * Suppress the browser copy and say so loudly.
 *
 * The CAPI leg still fires — `postTrack` is outside this guard — and the server
 * builds `value` from the authoritative order total. So the conversion is not
 * lost; only the malformed browser duplicate is withheld, which is precisely
 * the copy that would otherwise win deduplication and mask a correct value.
 */
function reportTrackingDefect(
  metaEvent: string,
  reason: string,
  data: Record<string, unknown>,
): void {
  try {
    console.warn(
      `[numu] suppressed browser ${metaEvent}: ${reason}. ` +
        "The server-side CAPI event still carries this conversion.",
      data,
    );
  } catch {
    /* console can be stubbed out by a theme */
  }
}

/** POST the CAPI/funnel event to the host proxy (which enriches _fbp/_fbc). */
function postTrack(extra: Record<string, unknown>): void {
  const win = w();
  if (!win) return;
  const body = {
    path: window.location.pathname,
    page_url: window.location.href,
    fingerprint: getSessionFingerprint(),
    referrer:
      typeof document !== "undefined" && document.referrer
        ? document.referrer
        : undefined,
    attribution: readAttribution() ?? undefined,
    customer_id: readCustomerId() ?? undefined,
    // Identity the shopper has typed into checkout this page-load, if any.
    // Sent raw to OUR origin; the API hashes it per Meta's field rules and
    // allowlists exactly these keys. Previously the checkout knew the email
    // and phone and forwarded them to neither the pixel nor this body, so
    // every guest event reached Meta with no PII at all.
    user_data: identityForCapi(),
    // Consent: when the merchant requires it and the visitor hasn't accepted,
    // the event still goes out but flagged `opt_out` — Meta's documented
    // modeled-conversions path (attribution math only, nothing retained), and
    // `limited_data_use` on TikTok. Returns undefined when consent isn't
    // required, so the field is absent and the payload is unchanged for the
    // stores that don't use this.
    opt_out: trackingOptOut(),
    ...extra,
  };
  void (async () => {
    try {
      await fetch("/api/storefront/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true, // survive the checkout → payment-redirect unload
      });
    } catch {
      /* fire-and-forget */
    }
  })();
}

/**
 * Remember / recall the `event_id` a funnel step fired with, per session.
 *
 * Used to RE-fire an event with the same id once better identity is known
 * (see `refireFunnelWithIdentity`). Meta and TikTok both dedupe on
 * `(pixel, event_name, event_id)`, so a second delivery under the same id is
 * treated as the same event — not a new conversion — while still contributing
 * its match keys. Best-effort: private mode / quota just means no re-fire.
 */
function rememberFunnelEventId(step: string, eventId: string): void {
  try {
    sessionStorage.setItem(`numu_evtid_${step}`, eventId);
  } catch {
    /* private mode — re-fire simply won't happen */
  }
}

function recallFunnelEventId(step: string): string | null {
  try {
    return sessionStorage.getItem(`numu_evtid_${step}`);
  } catch {
    return null;
  }
}

/**
 * Re-send an already-fired funnel step server-side, reusing its original
 * `event_id`, so the backend can attach identity it has since learned.
 *
 * Why this exists: `InitiateCheckout` fires when the shopper lands on the
 * checkout contact step — i.e. BEFORE they have typed anything — so for a
 * guest it carried no email, phone or name. Moving the fire to after the
 * contact step would fix the identity but lose the event entirely for anyone
 * who abandons at contact. Re-firing under the same id gets both: the entry
 * event still exists, and the enriched copy dedupes into it.
 *
 * CAPI-only on purpose — no `fbq`/`ttq` call. The browser already fired its
 * half; firing again would put a second browser event on the wire.
 */
export function refireFunnelWithIdentity(
  step: string,
  data: Record<string, unknown> = {},
): void {
  if (typeof window === "undefined") return;
  const eventId = recallFunnelEventId(step);
  if (!eventId) return; // never fired in this session — nothing to enrich
  postTrack({ event_id: eventId, step, step_data: cleanData(data) });
}

/**
 * Fire a funnel event on BOTH channels with one shared `event_id`:
 *   1. Browser Pixel  — fbq('track', <MetaEvent>, data, {eventID})
 *   2. CAPI via proxy — POST /api/storefront/track {step, step_data, event_id}
 *
 * `step` is a backend funnel-step name (e.g. "product_view"). Pass `eventId`
 * to align with an out-of-band CAPI event — e.g. Purchase uses the order id so
 * it dedupes against the payment-webhook CAPI Purchase.
 */
export function trackFunnel(
  step: string,
  data: Record<string, unknown> = {},
  opts: { eventId?: string } = {},
): void {
  if (typeof window === "undefined") return;
  const eventId = opts.eventId || getEventId();
  // Recorded so a later, better-identified re-fire can reuse this id instead
  // of minting a new one (which Meta would count as a second conversion).
  rememberFunnelEventId(step, eventId);
  const metaEvent = FUNNEL_STEP_TO_META[step];
  if (metaEvent) {
    // A conversion Meta cannot value is worse than a late one: Events Manager
    // reported 0% valid value on website Purchase for a live store because
    // `value` arrived undefined and `cleanData` stripped the key silently, so
    // the event looked perfectly well-formed from the inside. Never fire the
    // browser leg without a usable value — the server leg still carries the
    // conversion, and a loud console warning beats an invisible defect.
    const defect = conversionValueDefect(metaEvent, data);
    if (defect) {
      reportTrackingDefect(metaEvent, defect, data);
    } else {
      fbqTrack(metaEvent, data, eventId);
    }
  }
  // Fire the TikTok browser pixel with the SAME event_id so TikTok dedupes
  // the browser event against the server-side Events API fire. One dispatcher,
  // one /track POST — the backend fans the server side to BOTH Meta + TikTok.
  const tiktokEvent = FUNNEL_STEP_TO_TIKTOK[step];
  if (tiktokEvent) ttqTrack(tiktokEvent, data, eventId);
  postTrack({ event_id: eventId, step, step_data: cleanData(data) });
}

/**
 * First-party navigation tracking: POST the step to `/api/storefront/track`
 * WITHOUT firing any browser pixel.
 *
 * Used by <PageViewTracker> for the generic page_view / collection_view
 * steps that power NUMU's own sessions / bounce / conversion analytics.
 * The browser Meta PageView is <MetaPixel>'s job (initial snippet + its
 * route-change effect) — firing it here too would double every PageView.
 * The event_id is the shared per-navigation PageView id so the CAPI
 * PageView the backend enqueues for this POST dedupes against the
 * browser PageView <MetaPixel> fired for the same navigation.
 */
export function trackFirstPartyNavigation(
  step: string,
  data: Record<string, unknown> = {},
): void {
  if (typeof window === "undefined") return;
  postTrack({
    event_id: pageViewEventId(window.location.pathname),
    step,
    step_data: cleanData(data),
  });
}
