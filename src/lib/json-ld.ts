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
    /** The merchant's real SKU (`sku` on the public product payload). */
    sku?: string;
    /** Optional brand/vendor, if the payload ever carries one. */
    brand?: string;
    vendor?: string;
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
  /** Approved-review aggregate for this product (the `stats` block of
   *  `/products/{id}/reviews`). `aggregateRating` is emitted ONLY when the
   *  count is > 0 — a rating with no reviews behind it is an invalid rich
   *  result, not a partial one. */
  reviews?: { average?: number | null; count?: number | null } | null;
  /** `store.seo.has_return_policy_30d`. Gates `hasMerchantReturnPolicy`: we
   *  never assert a return window the merchant hasn't claimed, because Google
   *  can disprove it with a test order and demote the whole listing. */
  hasReturnPolicy30d?: boolean;
  /** Locale-resolved title/description for the request's language, from
   *  `localizedSeoText` (lib/seo.ts). REQUIRED for Arabic correctness: the
   *  fallback chain below starts at `seo_title`, which the platform stores in
   *  English only, so an Arabic PDP published an English Product name to Google
   *  even once `name`/`description` themselves were Arabic. Omitted → the
   *  English chain, which is what a non-localized caller wants. */
  seoText?: { title?: string | null; description?: string | null } | null;
}

/** Days of price validity we advertise. Google treats a merchant listing whose
 *  `priceValidUntil` has passed as stale and can stop showing the price; a
 *  rolling month is the shortest window that never goes stale between ISR
 *  regenerations. */
const PRICE_VALID_DAYS = 30;

export function buildProductLd({
  product,
  baseUrl,
  storeName,
  reviews,
  hasReturnPolicy30d,
  seoText,
}: BuildProductLdProps): Record<string, unknown> {
  const url = product.slug ? `${baseUrl}/products/${product.slug}` : baseUrl;
  const images = (product.images ?? [])
    .map((i) => i?.url)
    .filter((u): u is string => !!u);
  const priceValidUntil = new Date(
    Date.now() + PRICE_VALID_DAYS * 24 * 60 * 60 * 1000,
  )
    .toISOString()
    .slice(0, 10);
  const offers: Record<string, unknown> = {
    "@type": "Offer",
    url,
    priceCurrency: product.currency || "USD",
    availability: product.in_stock
      ? "https://schema.org/InStock"
      : "https://schema.org/OutOfStock",
    // Offer-level, which is where Google's product-snippet docs read it
    // (schema.org allows it on Product too, but only one placement is worth
    // emitting). Every NUMU catalogue is new goods.
    itemCondition: "https://schema.org/NewCondition",
    priceValidUntil,
  };
  if (typeof product.price === "number") offers.price = product.price;
  if (storeName) {
    offers.seller = { "@type": "Organization", name: storeName };
  }
  if (hasReturnPolicy30d) {
    offers.hasMerchantReturnPolicy = {
      "@type": "MerchantReturnPolicy",
      applicableCountry: "EG",
      returnPolicyCategory:
        "https://schema.org/MerchantReturnFiniteReturnWindow",
      merchantReturnDays: 30,
    };
    // Deliberately NO returnMethod/returnFees: the merchant flag says only
    // "30-day returns exist", so claiming free returns by mail on top of it
    // would be markup asserting something nobody promised.
  }

  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: seoText?.title || product.seo_title || product.name || "Product",
    description:
      seoText?.description || product.seo_description || product.description || "",
    image: images.length > 0 ? images : undefined,
    // The merchant's SKU, NOT product.id. Emitting the internal UUID here
    // published a "SKU" no shopper or feed could match (live PDPs showed
    // `"sku":"6dc03192-…"` while the real one was SKU-ZVFZSJN0), which breaks
    // the merchant-listing join between structured data and a product feed.
    sku: product.sku || product.id,
    url,
    offers,
  };
  // brand/vendor if the payload ever carries one, else the store name — which
  // is only as good as the name the merchant typed (a raw handle here is a
  // store-record problem, not a markup one).
  const brandName = product.brand || product.vendor || storeName;
  if (brandName) {
    ld.brand = { "@type": "Brand", name: brandName };
  }
  // Both a positive count AND a positive average are required: Google's rating
  // range starts at 1, so a 0 average with reviews behind it (or reviews with
  // no average) is an invalid rich result that invalidates the whole Product
  // block — worse than omitting it.
  if (
    typeof reviews?.count === "number" &&
    reviews.count > 0 &&
    typeof reviews.average === "number" &&
    reviews.average > 0
  ) {
    ld.aggregateRating = {
      "@type": "AggregateRating",
      ratingValue: reviews.average,
      reviewCount: reviews.count,
    };
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
  /** Locale-resolved title/description, same contract as `buildProductLd`. */
  seoText?: { title?: string | null; description?: string | null } | null;
}

export function buildCollectionLd({
  collection,
  baseUrl,
  seoText,
}: BuildCollectionLdProps): Record<string, unknown> {
  const url = collection.slug
    ? `${baseUrl}/collections/${collection.slug}`
    : baseUrl;
  return {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: seoText?.title || collection.name || "Collection",
    description: seoText?.description || collection.description || "",
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
/**
 * Query params that identify a *share event*, not the profile. Merchants
 * overwhelmingly paste links copied from a phone's share sheet or a QR code, so
 * these are the common case rather than the exception.
 */
const SOCIAL_TRACKING_PARAMS = new Set([
  "igsh",
  "igshid",
  "mibextid",
  "fbclid",
  "gclid",
  "si",
  "_rdr",
  "rdid",
  "ref",
  "ref_src",
  "ref_url",
  "share_url",
  // TikTok's share sheet appends these two to every copied profile link.
  "_t",
  "_r",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
]);

/** Mobile/legacy hostnames folded onto the canonical one the platform itself uses. */
const SOCIAL_HOST_ALIASES: Record<string, string> = {
  "instagram.com": "www.instagram.com",
  "m.instagram.com": "www.instagram.com",
  "instagr.am": "www.instagram.com",
  "facebook.com": "www.facebook.com",
  "m.facebook.com": "www.facebook.com",
  "web.facebook.com": "www.facebook.com",
  "fb.com": "www.facebook.com",
  "twitter.com": "x.com",
  "www.twitter.com": "x.com",
  "www.x.com": "x.com",
  "youtube.com": "www.youtube.com",
  "m.youtube.com": "www.youtube.com",
  "linkedin.com": "www.linkedin.com",
  "tiktok.com": "www.tiktok.com",
};

/**
 * Paths that point at a piece of content or a share redirect rather than at the
 * account. `facebook.com/share/r/<id>` is the one that shows up most: it is what
 * the Facebook app's share button produces, and it identifies nothing.
 */
const NON_PROFILE_PATHS = [
  /^\/share(\/|$)/i,
  /^\/p\//i,
  /^\/reel/i,
  /^\/stories\//i,
  /^\/posts\//i,
  /^\/watch/i,
];

/**
 * Reduce a merchant-supplied social link to the canonical profile URL, or null
 * if it does not identify an account.
 *
 * `sameAs` is how a search engine decides that this store and that Instagram
 * account are one entity. A URL carrying `?igsh=…&utm_source=qr` is not the
 * string the platform publishes as canonical, so it corroborates weakly at
 * best. A live store shipped exactly that, plus a `facebook.com/share/r/…`
 * redirect, which identifies no account at all.
 *
 * Returning null is deliberate for non-profile links: a wrong or meaningless
 * `sameAs` is worse than a missing one, because it actively points entity
 * resolution somewhere that isn't the merchant.
 */
export function canonicalizeSocialUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    // Not a URL at all. WhatsApp entries are routinely a bare phone number;
    // those belong in `telephone`, never here.
    return null;
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  url.protocol = "https:";
  url.username = "";
  url.password = "";
  url.hash = "";
  url.port = "";

  const host = url.hostname.toLowerCase();
  url.hostname = SOCIAL_HOST_ALIASES[host] ?? host;

  for (const key of [...url.searchParams.keys()]) {
    if (SOCIAL_TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }

  if (NON_PROFILE_PATHS.some((re) => re.test(url.pathname))) return null;

  // Compute on a local, then assign. Writing "" to URL.pathname normalises it
  // straight back to "/", so checking url.pathname after the write would never
  // catch a bare domain.
  const path = url.pathname.replace(/\/+$/, "");
  // A bare domain names the platform, not the merchant.
  if (path === "") return null;
  url.pathname = path;

  return url.toString();
}

export interface BuildOrganizationLdProps {
  baseUrl: string;
  storeName: string;
  logoUrl?: string | null;
  description?: string | null;
  socialLinks?: Record<string, string> | null;
  /** `store.seo.business_type` — a Schema.org Organization subtype such as
   *  "ClothingStore" or "JewelryStore". Null/absent = plain "Organization". */
  businessType?: string | null;
  /** `store.seo.same_as` — profile URLs the merchant declared explicitly.
   *  Merged with the ones derived from the social-links map: a merchant may
   *  list a marketplace or press page that is not a "social link" at all. */
  declaredProfiles?: string[] | null;
  /** Public contact. An organization with no way to reach it reads as
   *  unverified to both search and assistants. */
  email?: string | null;
  telephone?: string | null;
  /** `store.seo.area_served` — what "shops that deliver to X" is built from. */
  areaServed?: string[] | null;
  foundingYear?: number | null;
}

export function buildOrganizationLd({
  baseUrl,
  storeName,
  logoUrl,
  description,
  socialLinks,
  businessType,
  declaredProfiles,
  email,
  telephone,
  areaServed,
  foundingYear,
}: BuildOrganizationLdProps): Record<string, unknown> {
  // sameAs is the schema.org canonical for "list of social profiles"
  // — Twitter / Facebook / Instagram / etc. Search engines use this
  // to dedupe the merchant across channels in their entity graph.
  //
  // http(s) ONLY. The merchant's Social Links map is free-form and its
  // WhatsApp entry is routinely a bare phone number — a live store shipped
  // `"sameAs": ["+201098433918", …]`, which is not a URL and invalidates the
  // property. A phone belongs in `telephone`, never here.
  //
  // canonicalizeSocialUrl also strips share/QR tracking and drops links that
  // point at a post or a share redirect instead of the account — see its doc.
  const urls = socialLinks
    ? Object.values(socialLinks)
        .map((u) => (typeof u === "string" ? canonicalizeSocialUrl(u) : null))
        .filter((u): u is string => u !== null)
    : [];
  // Two aliases of one profile (m.facebook.com/x and www.facebook.com/x) collapse
  // to the same string above, and listing it twice weakens rather than doubles it.
  // Merchant-declared profiles get the same canonicalisation as the derived
  // ones — the field is free text in the SEO tab, so it can carry a share
  // link or a tracking-tagged URL just as easily.
  const declared = (declaredProfiles ?? [])
    .map((u) => (typeof u === "string" ? canonicalizeSocialUrl(u) : null))
    .filter((u): u is string => u !== null);
  const allUrls = [...urls, ...declared];
  const sameAs = allUrls.length > 0 ? [...new Set(allUrls)] : undefined;

  // Only emit what the merchant actually stated. An empty contactPoint or a
  // guessed areaServed is a claim, and a wrong claim costs more than a
  // missing one — the same reason sameAs is undefined rather than [].
  const areas = (areaServed ?? []).map((a) => a.trim()).filter(Boolean);
  const contactPoint =
    email || telephone
      ? {
          "@type": "ContactPoint",
          contactType: "customer support",
          ...(email ? { email } : {}),
          ...(telephone ? { telephone } : {}),
        }
      : undefined;

  return {
    "@context": "https://schema.org",
    // A merchant-declared subtype (ClothingStore, JewelryStore, …) is a direct
    // "this is a retailer, and of what" signal to the crawlers that classify
    // the store; every Schema.org Store subtype is also an Organization, so
    // consumers that only understand Organization still resolve it.
    "@type": businessType || "Organization",
    "@id": `${baseUrl}#organization`,
    name: storeName,
    url: baseUrl,
    description,
    logo: logoUrl,
    sameAs,
    ...(contactPoint ? { contactPoint } : {}),
    ...(email ? { email } : {}),
    ...(telephone ? { telephone } : {}),
    ...(areas.length > 0 ? { areaServed: areas } : {}),
    // Year only: schema.org/foundingDate takes ISO 8601, and a bare year is
    // valid. Inventing a month would be a fact nobody gave us.
    ...(foundingYear ? { foundingDate: String(foundingYear) } : {}),
  };
}

export interface FaqPair {
  question: string;
  answer: string;
}

/**
 * FAQPage JSON-LD from the merchant's own Q&A.
 *
 * The highest-leverage structured data a shop can publish: it is the only
 * place to answer "do you deliver to Aswan" in the words a shopper types, and
 * both rich results and answer engines read it directly.
 *
 * Returns null rather than an empty FAQPage when there is nothing to say —
 * an FAQPage with zero questions is an invalid entity, and publishing one is
 * worse than publishing none.
 */
export function buildFaqLd(
  baseUrl: string,
  faqs: FaqPair[] | null | undefined,
): Record<string, unknown> | null {
  const pairs = (faqs ?? [])
    .map((f) => ({
      question: (f?.question ?? "").trim(),
      answer: (f?.answer ?? "").trim(),
    }))
    .filter((f) => f.question && f.answer);
  if (pairs.length === 0) return null;

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "@id": `${baseUrl}#faq`,
    mainEntity: pairs.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
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
 *
 * SECURITY: the returned string is injected verbatim via
 * `dangerouslySetInnerHTML`. Plain `JSON.stringify` does NOT escape `<`,
 * so a merchant-controlled field (product `name`, `seo_description`, …)
 * containing `</script><script>…` would terminate the ld+json block and
 * inject an executable script — stored XSS. We escape the characters that
 * can break out of, or be misparsed inside, an HTML `<script>` element:
 *   `<` `>` `&`  → prevent closing/opening tags and entity tricks
 *   U+2028 U+2029 → JS line separators that break naive JS parsers
 * The result is still valid JSON (these are legal `\uXXXX` escapes), so
 * search engines parse it unchanged.
 */
export function serializeLd(ld: unknown): string {
  return JSON.stringify(ld, (_key, value) => (value === undefined ? null : value))
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
