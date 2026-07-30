/**
 * Cart value / contents for funnel events, in the shape Meta and TikTok want.
 *
 * Extracted from `<CartFunnelTracker>` so the checkout's AddPaymentInfo fires
 * can share it. They previously sent only `{ payment_method }` — no value, no
 * currency, no contents — which makes the event useless for value-based bid
 * optimisation and for dynamic-ads cart signals, the two things an
 * AddPaymentInfo is actually good for.
 *
 * Units: MAJOR (99.99), not cents. The cart API returns integer cents; the
 * conversion happens here, once, so no call site has to remember it.
 */

interface CartLine {
  product_id?: string;
  variant_id?: string;
  id?: string;
  quantity?: number;
  /** Unit price snapshot in CENTS (adapt-cart passthrough). */
  price?: number;
}

export interface CartFunnelData {
  // Index signature so this can be spread straight into `trackFunnel`'s
  // `Record<string, unknown>` payload without a cast at every call site.
  [key: string]: unknown;
  value?: number;
  currency?: string;
  num_items?: number;
  content_ids?: string[];
  content_type?: string;
  contents?: Array<{ id?: string; quantity: number; item_price?: number }>;
}

/**
 * Read the server cart and map it to funnel-event properties.
 *
 * Always resolves — a failed or malformed fetch yields `{}` (plus the
 * fallback currency) so the caller still fires its event. A funnel event with
 * no value beats no funnel event.
 */
export async function readCartFunnelData(
  fallbackCurrency?: string,
): Promise<CartFunnelData> {
  const data: CartFunnelData = {};
  try {
    const res = await fetch("/api/cart", {
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) return data;
    const json = await res.json();
    const cart = (json?.data ?? json) as {
      subtotal?: number;
      currency?: string;
      items?: CartLine[];
    };
    const items = Array.isArray(cart?.items) ? cart.items : [];
    const ids = items
      .map((li) => li.product_id || li.variant_id || li.id)
      .filter((x): x is string => typeof x === "string");

    if (typeof cart?.subtotal === "number") data.value = cart.subtotal / 100;
    data.currency = cart?.currency || fallbackCurrency || "EGP";
    data.num_items = items.reduce((n, li) => n + (Number(li.quantity) || 0), 0);
    if (ids.length) {
      data.content_ids = ids;
      data.content_type = "product";
      // `item_price` in MAJOR units — without it TikTok's contents mapper
      // (toTikTokProps) falls back to price: 0 on every line.
      data.contents = items.map((li) => ({
        id: li.product_id || li.variant_id || li.id,
        quantity: Number(li.quantity) || 1,
        ...(typeof li.price === "number" && li.price > 0
          ? { item_price: li.price / 100 }
          : {}),
      }));
    }
  } catch {
    /* fire with whatever we have */
  }
  return data;
}
