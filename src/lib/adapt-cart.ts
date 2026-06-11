/**
 * Adapt the FastAPI cart response → the `@numueg/theme-sdk` Cart contract.
 *
 * Two mismatches made the BYOT storefront cart render permanently empty:
 *   1. The backend wraps every response as `{ success, data, message }`, but
 *      the SDK reads the cart at the TOP level (`res.json() as Cart`).
 *   2. The backend uses its own field names (`unit_price`, `product_name`),
 *      while the SDK's CartItem expects `price` / `name`, and Cart expects a
 *      `total`.
 * Either alone leaves `cart.items` / prices `undefined` → empty cart.
 *
 * This unwraps the envelope and maps to the SDK shape. Money stays in CENTS —
 * the SDK runtime (`normalizeCartFromServer`) converts cents→major for
 * `<Money>` display, so we must NOT divide here.
 */
export function adaptCart(raw: unknown): unknown {
  const env = raw as { data?: unknown } | null;
  const c = (
    env && typeof env === "object" && "data" in env && env.data
      ? env.data
      : raw
  ) as Record<string, unknown> | null;
  if (!c || typeof c !== "object" || !Array.isArray(c.items)) return raw;

  const items = (c.items as Array<Record<string, unknown>>).map((it) => ({
    id: it.id,
    product_id: it.product_id,
    variant_id: it.variant_id ?? undefined,
    name: it.product_name ?? it.name ?? "",
    image_url: it.image_url ?? undefined,
    price: it.unit_price ?? it.price ?? 0,
    quantity: it.quantity ?? 0,
    variant_name: it.variant_name ?? undefined,
  }));

  return {
    id: c.id ?? "",
    items,
    subtotal: c.subtotal ?? 0,
    total: c.total ?? c.subtotal ?? 0,
    currency: c.currency ?? "EGP",
    ...(c.discount_code != null ? { discount_code: c.discount_code } : {}),
    ...(c.discount_amount != null ? { discount_amount: c.discount_amount } : {}),
  };
}
