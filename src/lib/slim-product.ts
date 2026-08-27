/**
 * Trim catalog rows before they are handed to a BYOT theme.
 *
 * ## Why this exists
 *
 * A BYOT page hands its product list to `<ByotThemeBoundary>`, a **client**
 * component. Every prop of a client component is serialized into the RSC flight
 * payload and inlined into the document as `self.__next_f.push([...])`. On
 * vionneeg.com's home page that one prop was **489 KB of the 1.19 MB document**
 * — 261 products, each carrying its full admin row.
 *
 * Measured field weights in that payload (bytes, all 261 rows):
 *
 *     seo_description  43,082      created_at        12,267
 *     google_product_  21,749      updated_at        12,267
 *       category                   seo_title         10,868
 *     store_id         12,789      canonical_url      5,420
 *     meta_catalog_id   5,742      cost_price         4,437
 *     sitemap_exclude   6,233      robots_noindex     5,962
 *
 * None of it is readable by a theme. `seo_*`, `canonical_url`,
 * `robots_noindex`, `sitemap_exclude` and `social_image_url` are consumed by
 * the host's own `generateMetadata` on the PRODUCT route, from a separate
 * detail fetch. `google_product_category` and `meta_catalog_id` exist for the
 * Merchant Center / Meta catalog feeds. `cost_price` is merchant-private margin
 * data that had no business being in a public page's HTML at all. `store_id` is
 * the store the visitor is already on, repeated 261 times.
 *
 * Verified against all sixteen V3 themes: `grep -rl` for each key across
 * the themes tree returns nothing for every name in DROP below. (`created_at`
 * and `store_id` do appear in theme code — on ORDER rows and as a query
 * parameter built from `shop.id`, never as `product.created_at` /
 * `product.store_id`.)
 *
 * ## Why a deny-list and not an allow-list
 *
 * Sixteen themes, three different product payload shapes (catalog list, related
 * products, and the detail route — only the last carries `variants`), plus
 * whatever a theme reads out of `attributes` / `metadata`. An allow-list would
 * silently blank a field some theme depends on, and the failure mode is a card
 * that renders wrong on one store. A deny-list can only remove things that were
 * checked, so the blast radius is bounded by this list.
 *
 * Deletion is **shallow, top-level only**, which matters: the teen theme reads
 * `attributes.continue_selling_when_out_of_stock`, and a nested key of the same
 * name must survive.
 *
 * `description` is deliberately NOT dropped. It is the single biggest field
 * (58 KB here), but bon-younes renders `it.description` on its menu cards and
 * four themes filter their search on it, so removing it is a visible regression
 * on some store somewhere.
 */

/** Top-level product keys no V3 theme reads. */
const DROP = new Set([
  // Host-side SEO, resolved per-route from the detail fetch.
  "seo_title",
  "seo_description",
  "canonical_url",
  "robots_noindex",
  "sitemap_exclude",
  "social_image_url",
  // Feed / integration plumbing.
  "google_product_category",
  "meta_catalog_id",
  // Admin bookkeeping.
  "store_id",
  "created_at",
  "updated_at",
  // Merchant-private margin data — should never reach a public document.
  "cost_price",
]);

/**
 * Trim ONE product row. Returns the input unchanged when it isn't an object.
 *
 * `images` are left alone on purpose — the API already emits them as `{id,
 * url}` and nothing else, so there is nothing to win and a shape to break (the
 * related-products endpoint returns plain URL strings in the same field).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function slimProductForTheme(product: any): any {
  if (!product || typeof product !== "object" || Array.isArray(product)) {
    return product;
  }
  const src = product as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src)) {
    if (DROP.has(key)) continue;
    out[key] = src[key];
  }
  return out;
}

/**
 * Trim a product list. A non-array becomes `[]` so callers can stay terse.
 *
 * Typed `any[]`, matching `fetchProducts` — the API rows are structurally
 * untyped here and a generic would only invent a guarantee this cannot keep.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function slimProductsForTheme(products: any[] | null | undefined): any[] {
  if (!Array.isArray(products)) return [];
  return products.map(slimProductForTheme);
}
