/**
 * JSON-LD structured data helpers.
 *
 * Returns plain JSON objects matching schema.org definitions. Caller
 * inlines them as `<script type="application/ld+json">{JSON}</script>`
 * inside the page body — Next 16 hoists them into the document and
 * Google/Bing/etc. parse them out of the rendered HTML.
 *
 * We deliberately keep these as data-only objects (not React
 * components) so server-rendered pages can mix them into static
 * metadata without paying for client hydration.
 */

interface BuildProductLdProps {
  product: {
    id?: string;
    name?: string;
    description?: string;
    slug?: string;
    price?: number;
    compare_at_price?: number;
    currency?: string;
    images?: { url?: string }[];
    in_stock?: boolean;
    seo_title?: string;
    seo_description?: string;
  };
  baseUrl: string;
  storeName?: string;
}

export function buildProductLd({
  product,
  baseUrl,
  storeName,
}: BuildProductLdProps): Record<string, unknown> {
  const url = product.slug ? `${baseUrl}/products/${product.slug}` : baseUrl;
  const images = (product.images ?? [])
    .map((i) => i?.url)
    .filter((u): u is string => !!u);
  const offers: Record<string, unknown> = {
    "@type": "Offer",
    url,
    priceCurrency: product.currency || "USD",
    availability: product.in_stock
      ? "https://schema.org/InStock"
      : "https://schema.org/OutOfStock",
  };
  if (typeof product.price === "number") offers.price = product.price;

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.seo_title || product.name || "Product",
    description: product.seo_description || product.description || "",
    image: images.length > 0 ? images : undefined,
    sku: product.id,
    url,
    offers,
  };
  if (storeName) {
    ld.brand = { "@type": "Brand", name: storeName };
  }
  if (
    typeof product.compare_at_price === "number" &&
    typeof product.price === "number" &&
    product.compare_at_price > product.price
  ) {
    // Highlight the discount via a `priceSpecification` block — search
    // engines surface this as a "sale" badge in rich results.
    (offers as Record<string, unknown>).priceSpecification = {
      "@type": "UnitPriceSpecification",
      priceType: "https://schema.org/SalePrice",
      price: product.price,
      priceCurrency: product.currency || "USD",
    };
  }
  return ld;
}

interface BuildBreadcrumbLdProps {
  trail: { name: string; url?: string }[];
}

export function buildBreadcrumbLd({
  trail,
}: BuildBreadcrumbLdProps): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      ...(t.url ? { item: t.url } : {}),
    })),
  };
}

interface BuildCollectionLdProps {
  collection: {
    name?: string;
    description?: string;
    slug?: string;
    products?: { name?: string; slug?: string }[];
  };
  baseUrl: string;
}

export function buildCollectionLd({
  collection,
  baseUrl,
}: BuildCollectionLdProps): Record<string, unknown> {
  const url = collection.slug
    ? `${baseUrl}/collections/${collection.slug}`
    : baseUrl;
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: collection.name || "Collection",
    description: collection.description || "",
    url,
    hasPart: (collection.products ?? []).slice(0, 10).map((p) => ({
      "@type": "Product",
      name: p.name,
      url: p.slug ? `${baseUrl}/products/${p.slug}` : undefined,
    })),
  };
}

/**
 * Phase 4.6 — Organization + WebSite JSON-LD for the home page.
 *
 * Google's rich-results docs recommend BOTH on a homepage:
 *   - Organization establishes the merchant identity (logo, social
 *     profiles, contact). Surfaces in the Knowledge Graph panel.
 *   - WebSite enables sitelinks search box (the search input that
 *     appears under the result in Google) when potentialAction is set.
 *
 * Both are static across the home renders, so callers can compute
 * once at module scope and inline. We don't compute SearchAction's
 * URL template here because it depends on the storefront's `/search`
 * route shape — caller passes baseUrl and we build it.
 */
export interface BuildOrganizationLdProps {
  baseUrl: string;
  storeName: string;
  logoUrl?: string | null;
  description?: string | null;
  socialLinks?: Record<string, string> | null;
}

export function buildOrganizationLd({
  baseUrl,
  storeName,
  logoUrl,
  description,
  socialLinks,
}: BuildOrganizationLdProps): Record<string, unknown> {
  // sameAs is the schema.org canonical for "list of social profiles"
  // — Twitter / Facebook / Instagram / etc. Search engines use this
  // to dedupe the merchant across channels in their entity graph.
  const sameAs = socialLinks
    ? Object.values(socialLinks).filter((u): u is string => !!u)
    : undefined;
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${baseUrl}#organization`,
    name: storeName,
    url: baseUrl,
    description,
    logo: logoUrl,
    sameAs,
  };
}

export interface BuildWebsiteLdProps {
  baseUrl: string;
  storeName: string;
}

export function buildWebsiteLd({
  baseUrl,
  storeName,
}: BuildWebsiteLdProps): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${baseUrl}#website`,
    name: storeName,
    url: baseUrl,
    // SearchAction: Google's "sitelinks search box" feature. The URL
    // template uses the same query param the storefront's /search
    // route already accepts.
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${baseUrl}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

/**
 * Render a JSON-LD object as a serialized `<script>` content. Strips
 * undefined keys (recursive) so the emitted JSON stays clean. Use the
 * return value as `dangerouslySetInnerHTML={{ __html: serialized }}`
 * inside a `<script type="application/ld+json">` element.
 */
export function serializeLd(ld: unknown): string {
  return JSON.stringify(ld, (_key, value) => (value === undefined ? null : value));
}
