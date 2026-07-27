/**
 * Generated Open Graph card for a STORE (`/<store>/opengraph-image`).
 *
 * Fills the gap left by a merchant who never uploaded a social image: without
 * this the store's pages carried no `og:image` at all and every WhatsApp /
 * Facebook / X share was a blank grey card.
 *
 * PRECEDENCE — a merchant's own social image wins, and the route enforces it
 * itself rather than trusting the metadata layer.
 *
 * Reading `mergeStaticMetadata` suggests the layout's `openGraph.images` would
 * suppress this convention file, but measured against the running app it does
 * NOT: the `[domain]` folder's static metadata is attached to the PAGE node as
 * well as the layout node, `page.tsx` exports no `generateMetadata`, so at that
 * level `source` is null, the "did this segment set images?" test passes, and
 * the generated card overwrites whatever the layout resolved. Verified on the
 * live dev server — the store home emitted this route's URL even though
 * `storeSocialImage` had returned the merchant's logo.
 *
 * So the tag cannot be relied on to defer, and the BYTES defer instead: when
 * the merchant has deliberately configured `seo.social_image_url`, this route
 * 302s to it. A crawler following the og:image lands on exactly the asset the
 * merchant chose.
 *
 * `banner_url` / `logo_url` deliberately do NOT redirect. Those are not social
 * images — a bare square logo is precisely the weak WhatsApp preview this work
 * exists to fix — and the logo is rendered INTO the card instead, at the size
 * and crop the format wants. That is a behaviour change for logo-only stores,
 * and an intended one.
 *
 * The satori/font/Arabic/webp constraints all live in `og-card.tsx`.
 *
 * URL SHAPE: Next builds the tag as `<metadataBase>/<domain>/opengraph-image`,
 * which on a subdomain store reads `https://vionne.numueg.app/vionne/…`. The
 * proxy's existing "double subdomain" self-correct 301s that to
 * `/opengraph-image` (query preserved) and rewrites it back under the store
 * segment, so the crawler resolves it in one extra hop rather than 404ing.
 */

import { fetchStoreByDomain } from "@/lib/api-client";
import {
  canonicalOriginFor,
  storeSeoDescription,
  storeSeoTitle,
  type StoreForSeo,
} from "@/lib/seo";
import {
  OG_CONTENT_TYPE,
  OG_SIZE,
  StoreOgCard,
  clampText,
  fetchCardImage,
  latinSafe,
  renderOgCard,
  safeImageUrl,
} from "./og-card";

export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "Store preview";

interface ImageProps {
  /** Metadata image routes receive params as a promise, same as pages. */
  params: Promise<{ domain: string }>;
}

/** Latin wordmark for a store whose name is Arabic-only (or unreadable after
 *  sanitising): the subdomain is Latin by construction, so `vionne` →
 *  `Vionne` beats printing nothing at all. */
function wordmarkFor(domain: string): string {
  const label = domain.split(".")[0].replace(/[-_]+/g, " ").trim();
  if (!label) return "NUMU";
  return label.replace(/(^|\s)([a-z])/g, (_m, sep, c) => sep + c.toUpperCase());
}

/** Strip the scheme (and any trailing slash) off the store's canonical origin
 *  — `canonicalOriginFor` is the ONE place that knows whether this store lives
 *  on a verified custom domain or a platform subdomain. */
function displayHost(store: StoreForSeo | null, domain: string): string {
  const origin = canonicalOriginFor(store, domain);
  return origin.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

export default async function StoreOpengraphImage({ params }: ImageProps) {
  const { domain } = await params;

  let store: StoreForSeo | null = null;
  try {
    store = (await fetchStoreByDomain(domain)) as unknown as StoreForSeo;
  } catch {
    // Unresolvable store (API down, bad host). We still owe the crawler a
    // valid image, so the card degrades to the domain wordmark rather than
    // erroring — a 500 here is what produces the blank preview we're fixing.
  }

  // The merchant's deliberate choice, served instead of ours (see PRECEDENCE
  // above). Same URL validation as the card's image fetcher, so a malformed or
  // loopback value falls through to the generated card rather than becoming a
  // redirect to nowhere.
  const chosen = safeImageUrl(store?.seo?.social_image_url);
  if (chosen) {
    return new Response(null, {
      status: 302,
      headers: {
        location: chosen.href,
        // Short: the merchant can swap this image in the hub at any time, and
        // the og:image URL never changes to signal it.
        "cache-control": "public, max-age=300",
      },
    });
  }

  const host = displayHost(store, domain);
  // With no store row there is nothing to describe, and the seo helpers'
  // null-store defaults ("NUMU Store" / "Shop NUMU …") would state something
  // untrue about this domain — the wordmark alone is the honest card.
  const name = store
    ? clampText(latinSafe(storeSeoTitle(store)), 48) || wordmarkFor(domain)
    : wordmarkFor(domain);
  // The default description from `storeSeoDescription` is Arabic for an
  // ar-default store; `latinSafe` empties it and the card simply drops the
  // line rather than printing a half-stripped sentence.
  const description = store
    ? clampText(latinSafe(storeSeoDescription(store)), 150)
    : "";
  // 320px: the logo is drawn into a 148px box, so anything larger is bytes
  // spent on a picture nobody sees.
  const logo = await fetchCardImage(store?.logo_url, 320);

  return renderOgCard(
    <StoreOgCard
      name={name}
      description={description}
      host={host}
      logo={logo}
    />,
    name,
  );
}
