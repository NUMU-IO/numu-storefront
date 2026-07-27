/**
 * Generated Open Graph card for a PRODUCT
 * (`/<store>/products/<slug>/opengraph-image`).
 *
 * Product photo + name + price, on the NUMU navy/saffron card, so a PDP shared
 * into WhatsApp reads as a priced product rather than a blank grey rectangle.
 * The constraints this has to live with (no CSS, Latin-only text, resilient
 * image fetch, never-500) are documented in `og-card.tsx`.
 *
 * ⚠️ PRECEDENCE — this card is currently INERT on the PDP. Next only applies a
 * file-convention image when the segment's `generateMetadata` does not set
 * `openGraph.images`, and it tests `hasOwnProperty('images')`, which is true
 * even when the value is `undefined`. `products/[slug]/page.tsx` always emits
 * the key (`images: pimg ? [pimg] : undefined`), so:
 *   - product HAS a photo  → that photo is the og:image (fine, if uncropped);
 *   - product has NO photo → the key is present-but-undefined, the convention
 *     is skipped, and the page still ships no og:image at all.
 * The one-line fix belongs to whoever owns that file: use the spread form the
 * twitter block right below it already uses — `...(pimg ? { images: [pimg] } :
 * {})` — and this card takes over the empty case. The route itself is live and
 * directly fetchable either way.
 */

import { fetchProductBySlug, fetchStoreByDomain } from "@/lib/api-client";
import { canonicalOriginFor, type StoreForSeo } from "@/lib/seo";
import type { StoreData } from "@/types";
import {
  OG_CONTENT_TYPE,
  OG_SIZE,
  ProductOgCard,
  StoreOgCard,
  clampText,
  fetchCardImage,
  latinSafe,
  ogPrice,
  renderOgCard,
} from "../../og-card";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Product preview";

interface ImageProps {
  /** Metadata image routes receive params as a promise, same as pages. */
  params: Promise<{ domain: string; slug: string }>;
}

function displayHost(store: StoreData | null, domain: string): string {
  return canonicalOriginFor(store as StoreForSeo | null, domain)
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

export default async function ProductOpengraphImage({ params }: ImageProps) {
  const { domain, slug } = await params;

  let store: StoreData | null = null;
  // `normalizeProduct` returns the loose API shape (seo_title, images[], …),
  // so this stays `any` for the same reason the PDP route does.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let product: any = null;
  try {
    store = await fetchStoreByDomain(domain);
    product = await fetchProductBySlug(store.id, slug);
  } catch {
    // Deleted/draft product, or an API blip. Handled below — a share of a dead
    // PDP should still show the shop, never an error.
  }

  const host = displayHost(store, domain);
  const storeName = clampText(latinSafe(store?.name), 34);

  // No product → fall back to the store card. It is the same brand surface and
  // it stays true (the store exists), which beats a card naming a product we
  // could not load.
  if (!product) {
    return renderOgCard(
      <StoreOgCard
        name={storeName || host}
        description=""
        host={host}
        logo={await fetchCardImage(store?.logo_url, 320)}
      />,
      storeName || host,
    );
  }

  // Same currency resolution the PDP uses for JSON-LD and the product:* OG
  // properties: the product's own currency, else the store's, else EGP. The
  // fetch boundary defaults an unset product currency to "USD", which would
  // otherwise price an Egyptian card in dollars.
  const currency = product.currency || store?.currency || "EGP";
  const price = ogPrice(Number(product.price) || 0, currency);
  const compare = Number(product.compare_at_price);
  const compareAt =
    Number.isFinite(compare) && compare > (Number(product.price) || 0)
      ? ogPrice(compare, currency)
      : null;

  // 64 chars ≈ four lines in the card's text column at 48px — past that the
  // title crowds the price out of the composition.
  const productName = clampText(
    latinSafe(product.seo_title || product.name),
    64,
  );
  // A portrait photo cover-cropped into the 560×630 panel is scaled by height,
  // so it needs ~2× the panel width to stay sharp.
  const image = await fetchCardImage(product.images?.[0]?.url, 1120);

  return renderOgCard(
    <ProductOgCard
      productName={productName}
      storeName={storeName}
      price={price}
      compareAt={compareAt}
      host={host}
      image={image}
    />,
    productName || storeName || host,
  );
}
