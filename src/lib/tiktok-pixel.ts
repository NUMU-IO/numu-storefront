/**
 * TikTok Pixel (browser) + Events-API bridge for the V3 storefront host.
 *
 * Sibling of `meta-pixel.ts`. The host owns the shell + checkout, so the whole
 * TikTok funnel fires from one place. The browser Pixel sets the `_ttp` cookie
 * and we capture `ttclid` from the URL into a cookie; the existing
 * `/api/storefront/track` proxy reads both server-side and forwards them to the
 * backend, which fans a hashed Events API event. Browser + Events API fires
 * share ONE `event_id` so TikTok's Events Manager dedupes the pair.
 *
 * IMPORTANT: this module is self-contained (its own window accessor, no import
 * from meta-pixel.ts) so `meta-pixel.ts` can import from HERE without a cycle —
 * `trackFunnel` fires both the Meta and TikTok browser pixels with one event_id
 * and makes ONE `/track` POST.
 *
 * Units: values are sent in MAJOR currency units (e.g. 99.99), same as Meta.
 */

// ── Store config → enabled pixel IDs ────────────────────────────────────────

interface TikTokPixelEntry {
  pixel_id?: string;
  pixel_enabled?: boolean;
}
interface TikTokSettings {
  pixel_id?: string;
  pixel_enabled?: boolean;
  pixels?: TikTokPixelEntry[];
}
// TikTok Pixel Codes are alphanumeric (~20 chars), NOT digits-only.
const TIKTOK_PIXEL_RE = /^[A-Za-z0-9]{6,40}$/;

/**
 * Resolve the store's enabled TikTok Pixel IDs.
 *
 * Precedence: multi-pixel array `tracking.tiktok.pixels[]` → single
 * `tracking.tiktok.pixel_id` → legacy flat `settings.tiktok_pixel_id`.
 * Returns `[]` when nothing valid is configured (caller skips the pixel).
 */
export function resolveTikTokPixelIds(store: unknown): string[] {
  const settings =
    store && typeof store === "object"
      ? (store as Record<string, unknown>).settings
      : undefined;
  const tracking =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>).tracking
      : undefined;
  const ttRaw =
    tracking && typeof tracking === "object"
      ? (tracking as Record<string, unknown>).tiktok
      : undefined;
  const tt: TikTokSettings =
    ttRaw && typeof ttRaw === "object" ? (ttRaw as TikTokSettings) : {};
  const valid = (id: unknown): id is string =>
    typeof id === "string" && TIKTOK_PIXEL_RE.test(id.trim());

  const ids: string[] = [];
  if (Array.isArray(tt.pixels)) {
    for (const p of tt.pixels) {
      if (p && p.pixel_enabled !== false && valid(p.pixel_id)) {
        ids.push(p.pixel_id.trim());
      }
    }
  }
  if (ids.length === 0 && tt.pixel_enabled !== false && valid(tt.pixel_id)) {
    ids.push(tt.pixel_id.trim());
  }
  if (ids.length === 0 && settings && typeof settings === "object") {
    const legacy = (settings as Record<string, unknown>).tiktok_pixel_id;
    if (valid(legacy)) ids.push(legacy.trim());
  }
  return Array.from(new Set(ids));
}

// ── Event map ────────────────────────────────────────────────────────────────

/**
 * Backend funnel-step → TikTok standard-event name. NB: TikTok's purchase
 * event is `CompletePayment` (NOT "Purchase"). `page_view` is intentionally
 * absent — bare page views fire via `ttq.page()`, not `ttq.track`.
 */
export const FUNNEL_STEP_TO_TIKTOK: Record<string, string> = {
  product_view: "ViewContent",
  add_to_cart: "AddToCart",
  checkout_started: "InitiateCheckout",
  add_payment_info: "AddPaymentInfo",
  order_completed: "CompletePayment",
  search: "Search",
  complete_registration: "CompleteRegistration",
  add_to_wishlist: "AddToWishlist",
  lead: "SubmitForm",
};

// ── Window accessor ──────────────────────────────────────────────────────────

interface TtqWindow {
  ttq?: {
    load?: (id: string) => void;
    page?: () => void;
    track?: (event: string, props?: unknown, opts?: unknown) => void;
    instance?: (id: string) => { track?: (e: string, p?: unknown, o?: unknown) => void };
  };
  __numuTikTokPixelIds?: string[];
}

function w(): TtqWindow | null {
  return typeof window === "undefined" ? null : (window as unknown as TtqWindow);
}

// ── Meta-shaped custom_data → TikTok properties ──────────────────────────────

/**
 * The host trackers build a Meta-shaped `data` object (content_ids, value,
 * contents:[{id,quantity,item_price}]). TikTok's `properties` uses `content_id`
 * (comma-joined), `contents:[{content_id,quantity,price}]`, value, currency.
 * Mirrors the backend `_to_tiktok_properties` so browser + server agree.
 */
export function toTikTokProps(
  data: Record<string, unknown>,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  if (data.value !== undefined && data.value !== null) props.value = data.value;
  props.currency = (data.currency as string) || "EGP";
  props.content_type = (data.content_type as string) || "product";

  // TikTok may carry its own ids (`tiktok_content_ids`): the Meta leg sends
  // `meta_catalog_id || id`, but the TikTok catalog feed is keyed on the
  // product UUID, so a Meta override must never leak into this payload.
  const idSource: unknown[] =
    Array.isArray(data.tiktok_content_ids) && data.tiktok_content_ids.length
      ? data.tiktok_content_ids
      : Array.isArray(data.content_ids)
        ? data.content_ids
        : data.content_id !== undefined && data.content_id !== null
          ? [data.content_id]
          : [];
  const contentIds = idSource
    .map((c) => String(c).trim())
    .filter((c) => c.length > 0);
  if (contentIds.length) {
    // `content_id` is the pixel-1.x key, kept for reporting continuity;
    // `content_ids` is the 2.0 key. Neither is what the catalog / Video
    // Shopping Ads pipeline reads — that is `contents[].content_id`, below.
    props.content_id = contentIds.join(",");
    props.content_ids = contentIds;
  }

  const rawContents = data.contents;
  let contents: Array<Record<string, unknown>> = Array.isArray(rawContents)
    ? rawContents
        .filter(
          (c): c is Record<string, unknown> => !!c && typeof c === "object",
        )
        .map((c) => ({
          content_id: String(c.id ?? c.content_id ?? "").trim(),
          quantity: Number(c.quantity ?? 1),
          price: c.item_price ?? c.price ?? 0,
        }))
        // TikTok counts a blank content_id as missing — drop the line.
        .filter((c) => c.content_id.length > 0)
    : [];
  if (!contents.length && contentIds.length) {
    // ViewContent / AddToCart / Purchase only pass `content_ids`. TikTok's
    // "Content ID is missing" diagnostic keys on `contents[].content_id`
    // (required for Video Shopping Ads), so synthesize one line per id.
    // Price and name are only trustworthy for a single-product event.
    const single = contentIds.length === 1;
    const qty =
      single && data.num_items !== undefined ? Number(data.num_items) || 1 : 1;
    contents = contentIds.map((id) => ({
      content_id: id,
      quantity: qty,
      ...(single && data.content_name
        ? { content_name: data.content_name }
        : {}),
      // `value` is a unit price only on browse events; a purchase payload
      // (it carries `order_id`) totals shipping, tax and fees too.
      ...(single &&
      qty === 1 &&
      !data.order_id &&
      typeof data.value === "number"
        ? { price: data.value }
        : {}),
    }));
  }
  if (contents.length) props.contents = contents;
  if (data.num_items !== undefined) props.quantity = data.num_items;
  if (data.query) props.query = data.query;
  if (data.order_id) props.order_id = data.order_id;
  return props;
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

/**
 * Fire a browser TikTok Pixel event to all initialized pixels (no-op if the
 * SDK isn't loaded — e.g. Events-API-only mode, or consent not granted).
 * `eventId` is passed as `event_id` so TikTok dedupes against the server fire.
 */
export function ttqTrack(
  tiktokEvent: string,
  data: Record<string, unknown> = {},
  eventId?: string,
): void {
  const ttq = w()?.ttq;
  if (!ttq || typeof ttq.track !== "function") return;
  try {
    ttq.track(
      tiktokEvent,
      toTikTokProps(data),
      eventId ? { event_id: eventId } : undefined,
    );
  } catch {
    /* a misbehaving pixel must never break the page */
  }
}

// ── ttclid capture ───────────────────────────────────────────────────────────

const TTCLID_COOKIE = "ttclid";
const TTCLID_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * Capture the `ttclid` URL param (present when the visitor arrives from a
 * TikTok ad) into a 30-day cookie + localStorage so the server-side proxy and
 * the order-time CompletePayment can attach it. Idempotent; safe to call on
 * every mount / navigation. Returns the current ttclid if known.
 */
export function ensureTtclidCaptured(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get("ttclid");
    if (fromUrl) {
      document.cookie = `${TTCLID_COOKIE}=${encodeURIComponent(fromUrl)}; path=/; max-age=${TTCLID_MAX_AGE}; SameSite=Lax`;
      try {
        window.localStorage.setItem(TTCLID_COOKIE, fromUrl);
      } catch {
        /* storage may be blocked */
      }
      return fromUrl;
    }
    const m = document.cookie.match(/(?:^|;\s*)ttclid=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
    try {
      return window.localStorage.getItem(TTCLID_COOKIE);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}
