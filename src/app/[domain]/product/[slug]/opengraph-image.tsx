/**
 * OG card for the SINGULAR PDP alias, `/[domain]/product/[slug]`.
 *
 * That route is not a redirect — it renders the plural PDP in place (see its
 * `page.tsx`), and 14 of 15 V3 themes link products singularly, so the URLs
 * shoppers actually paste into WhatsApp are mostly these. Without a card here
 * the alias would fall back to the store-level card while `/products/<slug>`
 * showed the product one.
 *
 * Import + local re-export rather than `export … from`, matching the sibling
 * `page.tsx`: Next's metadata loaders read a route file's named exports
 * statically, so `size` / `contentType` / `alt` must exist as real bindings on
 * this module.
 */

import ProductOpengraphImage, {
  alt as productAlt,
  contentType as productContentType,
  size as productSize,
} from "../../products/[slug]/opengraph-image";

export const size = productSize;
export const contentType = productContentType;
export const alt = productAlt;

export default ProductOpengraphImage;
