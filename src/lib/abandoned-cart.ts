/**
 * Abandoned-checkout emission (single source of truth).
 *
 * System design — see the NUMU-api `AbandonedCheckout` entity + the
 * `POST /storefront/store/{id}/cart/track` endpoint. The storefront upserts
 * an `abandoned_checkouts` row keyed by a stable `session_fingerprint`:
 *   - on every cart change (add / remove / quantity), and
 *   - at the checkout contact step (enriched with email / phone / address).
 * A background job flips the row to "abandoned" after inactivity and the
 * merchant's recovery flow (WhatsApp / email) acts on it; a completed order
 * graduates the row (`mark_recovered`, matched by fingerprint / email).
 *
 * This module is the ONE emit point so cart-change tracking and contact-step
 * tracking can never drift in payload shape.
 */

import { resolveTrafficSource } from "@/lib/cart-track-attribution";
import { getSessionFingerprint } from "@/lib/meta-pixel";

export type CartTrackOverrides = {
  email?: string;
  phone?: string;
  shipping_address?: Record<string, unknown>;
  coupon_code?: string;
};

type CartItem = Record<string, unknown>;

// Skip re-POSTing an unchanged snapshot: a global cart-change listener would
// otherwise re-fire on every SPA navigation that re-emits `numu:cart:updated`.
// Reset naturally on a full page reload (module re-evaluates).
let lastSignature: string | null = null;

/**
 * Read the current cart and upsert it into the backend's abandoned-checkout
 * store. Best-effort: never throws, never blocks the shopper. Pass
 * `overrides` (email / phone / shipping_address / coupon) at the contact
 * step to enrich the row; omit them for plain cart-change tracking (the
 * backend fills a logged-in customer's email from the forwarded cookie).
 */
export async function trackCartState(
  overrides: CartTrackOverrides = {},
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const res = await fetch("/api/cart", {
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) return;
    const json = await res.json();
    const cart = (json?.data ?? json) as {
      subtotal?: number;
      currency?: string;
      items?: CartItem[];
    };
    const items = Array.isArray(cart?.items) ? cart.items : [];
    if (!items.length) return; // empty cart — nothing to recover

    const line_items = items.map((li) => {
      const quantity = Number(li.quantity) || 1;
      const total_price = Number(li.total_price) || 0;
      return {
        product_id: li.product_id,
        product_name: li.product_name ?? li.name,
        variant_id: li.variant_id ?? undefined,
        variant_name: li.variant_name ?? undefined,
        sku: li.sku ?? undefined,
        quantity,
        unit_price: Number(li.unit_price) || Math.round(total_price / quantity),
        total_price,
      };
    });

    const subtotal =
      Number(cart?.subtotal) ||
      line_items.reduce((n, li) => n + (Number(li.total_price) || 0), 0);
    const payload: Record<string, unknown> = {
      session_fingerprint: getSessionFingerprint(),
      // Where the shopper came from — explicit UTMs, else derived from ad
      // click ids (fbclid→facebook, gclid→google, ttclid→tiktok). Feeds the
      // merchant dashboard's traffic-source icon on abandoned checkouts.
      ...resolveTrafficSource(),
      line_items,
      subtotal,
      // Shipping/tax aren't known until the shipping step, so the recoverable
      // value is the cart subtotal. Populating `total` (was left at the
      // backend's 0 default) is what the merchant dashboard's "Value" column
      // reads — without it every abandoned checkout showed 0.
      total: subtotal,
      currency: cart?.currency || "EGP",
    };
    if (overrides.email) payload.email = overrides.email;
    if (overrides.phone) payload.phone = overrides.phone;
    if (overrides.shipping_address)
      payload.shipping_address = overrides.shipping_address;
    if (overrides.coupon_code) payload.coupon_code = overrides.coupon_code;

    // Recovery-link continuity: the /api/cart/recover redirect stamped the
    // restored abandoned-checkout id in this cookie. Sending it lets the
    // backend update the ORIGINAL row (which carries the contact we
    // messaged) instead of creating a duplicate contactless row under this
    // session's brand-new fingerprint.
    const recoveredId = decodeURIComponent(
      document.cookie.match(/(?:^|; )numu_recovered_id=([^;]+)/)?.[1] ?? "",
    );
    // Only a UUID is worth sending — the backend field is typed UUID and a
    // junk ?cart= value would 422 the whole track payload.
    if (/^[0-9a-f-]{36}$/i.test(recoveredId)) {
      payload.recovered_from_id = recoveredId;
    }

    const body = JSON.stringify(payload);
    // Contact/address enrichment must always be sent; plain cart snapshots
    // are de-duped so browsing navigation doesn't spam the endpoint.
    const hasOverrides = Boolean(
      overrides.email ||
        overrides.phone ||
        overrides.shipping_address ||
        overrides.coupon_code,
    );
    if (!hasOverrides && body === lastSignature) return;
    lastSignature = body;

    await fetch("/api/storefront/cart-track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body,
    });
  } catch {
    /* best-effort — never block the shopper on a tracking write */
  }
}
