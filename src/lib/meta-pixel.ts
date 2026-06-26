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

  const ids: string[] = [];
  if (Array.isArray(meta.pixels)) {
    for (const p of meta.pixels) {
      if (p && p.pixel_enabled !== false && valid(p.pixel_id)) {
        ids.push(p.pixel_id.trim());
      }
    }
  }
  if (ids.length === 0 && meta.pixel_enabled !== false && valid(meta.pixel_id)) {
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

/**
 * Stable per-session fingerprint, identical strategy to the SDK. Exported so
 * other host surfaces (e.g. abandoned-cart tracking) share the same session id.
 */
export function getSessionFingerprint(): string {
  const win = w();
  if (!win) return "ssr";
  const sid = readAttribution()?.session_id;
  if (sid) return sid;
  if (win.__numu_session_fp) return win.__numu_session_fp;
  const fp = crypto.randomUUID();
  win.__numu_session_fp = fp;
  return fp;
}

export function getEventId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

function cleanData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
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
  const metaEvent = FUNNEL_STEP_TO_META[step];
  if (metaEvent) fbqTrack(metaEvent, data, eventId);
  postTrack({ event_id: eventId, step, step_data: cleanData(data) });
}
