/**
 * Shared SEO helpers for the V3 storefront host — the global metadata defaults
 * + the store-status/indexing gate that V2 had (numu-egyptian-bazaar's
 * seo-server.ts) and V3 had lost.
 *
 * The gate keys off two fields the backend already exposes on the public store
 * payload (`_serialize_public_store`): `status` (active/inactive/suspended/
 * pending_approval) and `seo.robots_indexing_enabled`. A suspended or
 * merchant-opted-out store must NOT be crawlable.
 */

import type { Metadata } from "next";

const PLATFORM_DOMAIN = process.env.NUMU_PLATFORM_DOMAIN || "numueg.app";
const IS_PROD = process.env.NEXT_PUBLIC_NUMU_ENV === "production";

/** Loose store shape — the host's StoreData doesn't type these fields, but the
 *  backend sends them. Optional throughout; we narrow defensively. */
export interface StoreForSeo {
  id?: string;
  name?: string | null;
  subdomain?: string | null;
  custom_domain?: string | null;
  description?: string | null;
  default_language?: string | null;
  logo_url?: string | null;
  banner_url?: string | null;
  status?: string | null;
  seo?: {
    seo_title?: string | null;
    seo_description?: string | null;
    social_image_url?: string | null;
    robots_indexing_enabled?: boolean | null;
    google_site_verification?: string | null;
    bing_site_verification?: string | null;
    /** Schema.org Organization subtype the merchant picked (e.g.
     *  "ClothingStore"). Narrows the homepage Organization JSON-LD from a
     *  generic org to a retailer — a classification signal Meta and Google
     *  both read. Null = plain "Organization". */
    business_type?: string | null;
    /** The merchant has committed to a 30-day return window. Gates the
     *  PDP's `hasMerchantReturnPolicy` — we never assert a policy the
     *  merchant hasn't claimed. */
    has_return_policy_30d?: boolean | null;
    /** The catalogue actually carries Arabic copy. Gates the `ar` hreflang —
     *  see alternatesFor. Default false: chrome being bilingual is not the
     *  same as the products being translated. */
    arabic_content_ready?: boolean | null;
  } | null;
  country?: string | null;
  settings?: Record<string, unknown> | null;
  theme_settings?: Record<string, unknown> | null;
}

/** The custom-domain lifecycle block the backend persists under
 *  `settings.custom_domain` (`_persist_domain_state` in stores.py). */
interface CustomDomainSettings {
  custom_domain?: {
    hostname?: string | null;
    /** pending_dns › verifying › active, or failed. */
    status?: string | null;
  } | null;
}

export const NOINDEX_ROBOTS: Metadata["robots"] = {
  index: false,
  follow: false,
  nocache: true,
  googleBot: { index: false, follow: false },
};

const INDEX_ROBOTS: Metadata["robots"] = {
  index: true,
  follow: true,
  googleBot: {
    index: true,
    follow: true,
    "max-image-preview": "large",
    "max-snippet": -1,
    "max-video-preview": -1,
  },
};

/** True when the store must NOT be indexed (suspended/inactive/pending, or the
 *  merchant flipped indexing off). A null store also blocks. */
export function storeBlocksIndexing(store: StoreForSeo | null | undefined): boolean {
  if (!store) return true;
  const status = (store.status ?? "").toLowerCase();
  if (status && status !== "active") return true;
  if (store.seo?.robots_indexing_enabled === false) return true;
  return false;
}

export function storeRobots(
  store: StoreForSeo | null | undefined,
  opts: { forceNoindex?: boolean } = {},
): Metadata["robots"] {
  if (opts.forceNoindex || storeBlocksIndexing(store)) return NOINDEX_ROBOTS;
  return INDEX_ROBOTS;
}

/**
 * The merchant's custom hostname — but ONLY once it actually serves the store.
 *
 * `store.custom_domain` is written the moment the merchant types a domain into
 * the hub's Domains tab, BEFORE Cloudflare validates DNS or issues a cert, and
 * it stays written when validation never succeeds. The lifecycle lives beside
 * it in `settings.custom_domain.status` (pending_dns › verifying › active, or
 * failed), so only `active` means the hostname resolves to this storefront.
 *
 * Canonicalising to an unverified host is how a live store de-indexes itself:
 * every URL declares "the real me lives at <host>", Google follows, gets
 * nothing, and drops the URLs that do work. That is exactly what happened in
 * production (an unowned domain typed into the Domains tab) — the store row was
 * cleaned up afterwards, but the code kept trusting the column, so the next
 * merchant to type a domain would have repeated it.
 */
function verifiedCustomHost(store: StoreForSeo | null | undefined): string | null {
  const host = (store?.custom_domain ?? "").trim();
  if (!host) return null;
  const status = (
    (store?.settings as unknown as CustomDomainSettings | null | undefined)
      ?.custom_domain?.status ?? ""
  )
    .toString()
    .toLowerCase();
  return status === "active" ? host : null;
}

/** Canonical origin: VERIFIED custom domain › subdomain in prod; path-segment
 *  in dev. The ONE origin helper — every surface that builds an absolute
 *  storefront URL must go through here so canonical, og:url, hreflang and
 *  JSON-LD can never disagree about which host the store lives on. */
export function canonicalOriginFor(
  store: StoreForSeo | null | undefined,
  domain: string,
): string {
  if (IS_PROD) {
    const custom = verifiedCustomHost(store);
    if (custom) return `https://${custom}`;
    const sub = (store?.subdomain ?? "").trim() || domain;
    return `https://${sub}.${PLATFORM_DOMAIN}`;
  }
  return `http://localhost:3100/${domain}`;
}

/** Normalize a storefront path for canonical/alternate URLs: leading slash, no
 *  trailing slash, no query/fragment — `/products`, `/products/` and
 *  `/products?utm_source=ig` must all advertise the SAME canonical, otherwise
 *  every campaign link splits the page's ranking signals. Root → "". */
function canonicalPath(path: string | null | undefined): string {
  const raw = (path ?? "").split("#")[0].split("?")[0].trim();
  if (!raw || raw === "/") return "";
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.length > 1 && withSlash.endsWith("/")
    ? withSlash.slice(0, -1)
    : withSlash;
}

/**
 * Absolute canonical URL for ONE storefront route.
 *
 * The `[domain]` layout used to emit `alternates.canonical = <origin>` for its
 * whole subtree, and Next inherits a parent's `alternates` into every child
 * that doesn't override them. So /products, /collections, /blogs, /pages/*,
 * /policies/*, /search — every route except the PDP and collection detail —
 * declared itself a duplicate of the home page, and Google drops duplicates.
 * Canonicals are per-URL: pass the route's own path.
 */
export function canonicalFor(
  store: StoreForSeo | null | undefined,
  domain: string,
  path?: string | null,
): string {
  const origin = canonicalOriginFor(store, domain);
  // An ADVERTISED locale prefix is kept, so `/ar/products/x` is its own
  // canonical; anything else the proxy accepted as a locale is dropped (see
  // ADVERTISED_LOCALE_PREFIXES).
  const { prefix, rest } = splitLocalePrefix(canonicalPath(path));
  const p = prefix ? `/${prefix}${rest}` : rest;
  // The root keeps its trailing slash: that is the form the store is linked
  // and indexed under, and `metadataBase` is built from the same string.
  return p ? `${origin}${p}` : `${origin}/`;
}

/** Locale URL prefixes `proxy.ts` resolves: it strips a leading 2-letter
 *  segment and stamps `x-numu-locale`, so `/ar/...` is the path-prefixed form
 *  the storefront actually serves (the `?locale=` query works too, but a
 *  query-string alternate is far weaker to crawlers). */
const LOCALE_PREFIXES = ["en", "ar"] as const;

/** Markets the platform onboards (OnboardingWizard). The region half of an
 *  hreflang has to match the store's own market — `ar-EG` on a Saudi store
 *  tells Google the page targets Egyptian shoppers. */
const SUPPORTED_REGIONS = new Set(["EG", "SA", "AE", "JO", "KW"]);

function hreflangRegion(store: StoreForSeo | null | undefined): string {
  const country = (store?.country ?? "").trim().toUpperCase();
  return SUPPORTED_REGIONS.has(country) ? country : "EG";
}

/**
 * Does this store have Arabic worth advertising to a crawler?
 *
 * Bilingual CHROME is not a bilingual CATALOGUE. The nav, buttons and the SSR
 * layer are Arabic on every store, but product names and descriptions come
 * from the merchant — and until `attributes.nameAr` is actually written, the
 * `/ar` pages carry English product copy under an Arabic shell. Advertising
 * `ar-EG` for that is the "translated boilerplate over single-language body"
 * pattern Google's multi-regional guidance calls out, at catalogue scale.
 *
 * So it is opt-in, defaulting to false: a store says so explicitly once its
 * products are translated.
 */
function hasArabicCatalogue(store: StoreForSeo | null | undefined): boolean {
  return store?.seo?.arabic_content_ready === true;
}

/**
 * The locale prefixes we advertise — and therefore the only ones allowed to own
 * a canonical of their own.
 *
 * `proxy.ts` treats ANY 2-letter first segment as a locale and falls back to the
 * store's default language for codes it doesn't know, so `/zz/products/x`,
 * `/qq/products/x`, … all render the same page as `/products/x`. Those must keep
 * consolidating into the un-prefixed URL: self-canonicalising every 2-letter
 * prefix would mint 676 crawlable near-duplicates of the entire catalogue.
 */
const ADVERTISED_LOCALE_PREFIXES: ReadonlySet<string> = new Set(
  LOCALE_PREFIXES,
);

/**
 * Split an already-normalized path into its ADVERTISED locale prefix and the
 * locale-free remainder:
 *   `/ar/products/x` → `{ prefix: "ar", rest: "/products/x" }`
 *   `/products/x`    → `{ prefix: null, rest: "/products/x" }`
 *   `/zz/products/x` → `{ prefix: null, rest: "/products/x" }`  (prefix dropped)
 *   `/ar`            → `{ prefix: "ar", rest: "" }`
 */
function splitLocalePrefix(p: string): { prefix: string | null; rest: string } {
  const seg = p.split("/")[1] ?? "";
  if (!/^[a-z]{2}$/i.test(seg)) return { prefix: null, rest: p };
  const lower = seg.toLowerCase();
  return {
    prefix: ADVERTISED_LOCALE_PREFIXES.has(lower) ? lower : null,
    rest: p.slice(seg.length + 1),
  };
}

/**
 * `alternates` for a route: the per-URL canonical plus en/ar hreflang.
 *
 * Arabic is where Egyptian shoppers actually search, and the storefront has
 * served full ar content (og:locale already emits ar_EG) without ever telling
 * a crawler the Arabic URL exists.
 *
 * Each locale is SELF-canonical: `/ar/products/x` canonicalises to itself, not
 * to `/products/x`. Google only honours hreflang annotations that sit on
 * self-canonical pages, so while every Arabic URL declared its English twin
 * canonical the entire cluster was discarded and Arabic could not rank — the
 * annotations were there, pointing at pages that disowned them. The locale
 * prefix reaches us because `proxy.ts` stamps the pre-strip pathname on
 * `x-numu-visitor-path`.
 *
 * `x-default` stays the UN-prefixed URL: that is the one serving the store's own
 * `default_language`, and the form the store is linked and indexed under. The
 * hreflang set is always built from the locale-free path, so the same map is
 * emitted no matter which locale URL is being rendered.
 */
export function alternatesFor(
  store: StoreForSeo | null | undefined,
  domain: string,
  path?: string | null,
): NonNullable<Metadata["alternates"]> {
  const canonical = canonicalFor(store, domain, path);
  const origin = canonicalOriginFor(store, domain);
  // Strip any advertised locale prefix FIRST, then build every alternate from
  // the locale-free remainder. Without this, rendering `/ar/products/x` emits
  // `${origin}/ar/ar/products/x` — a 404 announced to Google as the Arabic
  // version of the page.
  const { rest } = splitLocalePrefix(canonicalPath(path));
  const region = hreflangRegion(store);
  const arabicReady = hasArabicCatalogue(store);
  const languages: Record<string, string> = {};
  for (const prefix of LOCALE_PREFIXES) {
    if (prefix === "ar" && !arabicReady) continue;
    languages[`${prefix}-${region}`] = `${origin}/${prefix}${rest}`;
  }
  // x-default is the UN-prefixed URL (the one serving the store's own
  // default_language), not whichever locale URL happens to be rendering.
  // With no Arabic alternate there is only one version of the page, so an
  // x-default — which exists to pick BETWEEN alternates — would be noise.
  if (arabicReady) languages["x-default"] = canonicalFor(store, domain, rest);
  return { canonical, languages };
}

/**
 * The visitor-facing path of the current request.
 *
 * Prefers `x-numu-visitor-path` — the PRE-strip pathname, so a locale-prefixed
 * URL survives as `/ar/products/aisha-scarf`. Falls back to `x-numu-pathname`
 * (the rewritten `/vionne/products/aisha-scarf`) for a request that reached the
 * app without the newer header, and to "/" when neither is present (a request
 * that bypassed the proxy entirely). The fallback loses only the locale prefix,
 * i.e. it degrades to exactly the behaviour that shipped before.
 *
 * A layout's `generateMetadata` never sees the child route's params, so these
 * headers are the only channel through which the shared `[domain]` layout can
 * emit a per-URL canonical instead of one origin for the whole subtree.
 */
export function visitorPathFromHeaders(
  headerList: { get(name: string): string | null },
  domain: string,
): string {
  const raw = (
    headerList.get("x-numu-visitor-path") ??
    headerList.get("x-numu-pathname") ??
    ""
  ).trim();
  if (!raw) return "/";
  // Strip the tenant segment only on a real segment boundary: a bare
  // `startsWith("/" + domain)` also matches a different store whose subdomain
  // merely starts with this one (`/vionne` vs `/vionne-outlet`). The visitor
  // path carries no tenant segment under host-based routing, but it does under
  // dev path-segment routing — and the fallback header always does.
  const prefix = `/${domain}`;
  if (raw === prefix) return "/";
  if (raw.startsWith(`${prefix}/`)) return raw.slice(prefix.length);
  return raw;
}

/**
 * A route's OWN path, carrying the visitor URL's locale prefix.
 *
 * The PDP and collection routes know their path exactly (`/products/<slug>`) and
 * must keep using it — deriving the whole path from a header would send the
 * canonical of a proxy-less request to the store root. What they cannot know is
 * whether the visitor asked for `/ar/products/<slug>`, which is what makes the
 * Arabic URL self-canonical.
 *
 * The prefix comes from the visitor PATH, deliberately NOT from
 * `x-numu-locale`: that header also resolves `?locale=` and the `numu_locale`
 * cookie, so an ar-cookied visitor on the un-prefixed URL would have
 * `/products/x` canonicalise onto `/ar/products/x` while its own `x-default`
 * pointed back at `/products/x` — annotations contradicting each other. Only the
 * URL prefix is a statement about WHICH URL this is.
 */
export function localizedPathFor(
  headerList: { get(name: string): string | null },
  domain: string,
  path: string,
): string {
  const { prefix } = splitLocalePrefix(
    canonicalPath(visitorPathFromHeaders(headerList, domain)),
  );
  const p = canonicalPath(path);
  return prefix ? `/${prefix}${p}` : p;
}

export function storeSeoTitle(store: StoreForSeo | null | undefined): string {
  return (store?.seo?.seo_title || store?.name || "NUMU Store").trim();
}

/**
 * Shipping phrasing per market for the generated description.
 *
 * The old sentence hardcoded "shipping across Egypt. Cash on delivery
 * available." for EVERY store, including the SA/AE/JO/KW markets onboarding
 * offers — so a Saudi store published a factually false shipping AND payment
 * claim in its meta description. COD is asserted only where the platform
 * actually runs it (Egypt); everywhere else the sentence stays true by
 * claiming less.
 */
const SHIPPING_BLURB: Record<string, { en: string; ar: string }> = {
  EG: {
    en: "with shipping across Egypt. Cash on delivery available.",
    ar: "وتوصيل لكل محافظات مصر، والدفع عند الاستلام متاح.",
  },
  SA: {
    en: "with shipping across Saudi Arabia.",
    ar: "وتوصيل لجميع مناطق المملكة العربية السعودية.",
  },
  AE: {
    en: "with shipping across the UAE.",
    ar: "وتوصيل لجميع إمارات الدولة.",
  },
  JO: { en: "with shipping across Jordan.", ar: "وتوصيل لكل محافظات الأردن." },
  KW: { en: "with shipping across Kuwait.", ar: "وتوصيل لجميع مناطق الكويت." },
};

const SHIPPING_BLURB_DEFAULT = { en: "— a curated selection.", ar: "— تشكيلة مختارة." };

export function storeSeoDescription(store: StoreForSeo | null | undefined): string {
  const explicit = (store?.seo?.seo_description ?? "").trim();
  if (explicit) return explicit;
  const desc = (store?.description ?? "").trim();
  if (desc) return desc;
  const name = (store?.name ?? "").trim() || "NUMU";
  const ar = (store?.default_language ?? "").toLowerCase() === "ar";
  const country = (store?.country ?? "").trim().toUpperCase();
  const blurb = SHIPPING_BLURB[country];
  if (!blurb) {
    return ar
      ? `تسوّق من ${name} ${SHIPPING_BLURB_DEFAULT.ar}`
      : `Shop ${name} ${SHIPPING_BLURB_DEFAULT.en}`;
  }
  return ar
    ? `تسوّق من ${name} — تشكيلة مختارة ${blurb.ar}`
    : `Shop ${name} — a curated selection ${blurb.en}`;
}

/** True when the request's resolved locale is Arabic (`ar`, `ar-EG`, `ar_EG`). */
export function isArabicLocale(locale: string | null | undefined): boolean {
  return (locale ?? "").trim().toLowerCase().startsWith("ar");
}

/** The trimmed string, or null for anything that isn't usable copy. */
function nonEmptyText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/** A loose catalogue entity — product or collection — plus the Arabic copy the
 *  platform stores under `attributes` (`nameAr`, `descriptionAr`, `seoTitleAr`,
 *  `seoDescriptionAr`). The Product model has no i18n columns, so `attributes`
 *  is the only place per-product Arabic text can live. */
export interface SeoTextEntity {
  name?: string | null;
  description?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  attributes?: Record<string, unknown> | null;
}

/**
 * The `<title>` / `meta description` — and the JSON-LD name/description — for
 * one catalogue entity in the request's locale.
 *
 * `/ar/products/x` emitted the ENGLISH `seo_title`/`seo_description` regardless
 * of locale: the Arabic URL was fully indexable and described itself in English,
 * i.e. in the one language an Arabic search query cannot match. Order for
 * Arabic:
 *   1. `attributes.seoTitleAr` / `seoDescriptionAr` — purpose-written SEO copy.
 *   2. `attributes.nameAr` / `descriptionAr` — the Arabic product copy.
 *   3. the English fields, so an entity with no Arabic still has metadata.
 * English is unchanged: `seo_title || name`, `seo_description || description`.
 *
 * Step 2 is usually redundant for products — `normalizeProduct` (api-client.ts)
 * has already swapped `name`/`description` to Arabic by the time one reaches
 * here — but it is what keeps the helper correct for entities that never pass
 * through that boundary, and it is what makes `seo_title` (which is NOT
 * substituted, and which wins over the name) stop overriding Arabic copy.
 */
export function localizedSeoText(
  entity: SeoTextEntity | null | undefined,
  locale: string | null | undefined,
): { title: string; description: string } {
  const en = {
    title: nonEmptyText(entity?.seo_title) ?? nonEmptyText(entity?.name) ?? "",
    description:
      nonEmptyText(entity?.seo_description) ??
      nonEmptyText(entity?.description) ??
      "",
  };
  if (!isArabicLocale(locale)) return en;
  const attrs = entity?.attributes ?? null;
  return {
    title:
      nonEmptyText(attrs?.seoTitleAr) ?? nonEmptyText(attrs?.nameAr) ?? en.title,
    description:
      nonEmptyText(attrs?.seoDescriptionAr) ??
      nonEmptyText(attrs?.descriptionAr) ??
      en.description,
  };
}

export function storeSocialImage(store: StoreForSeo | null | undefined): string | null {
  const s = (store?.seo?.social_image_url ?? "").trim();
  if (s) return s;
  const b = (store?.banner_url ?? "").trim();
  if (b) return b;
  const l = (store?.logo_url ?? "").trim();
  return l || null;
}

function ogLocale(store: StoreForSeo | null | undefined): string {
  return (store?.default_language ?? "").toLowerCase() === "ar" ? "ar_EG" : "en_EG";
}

export function buildOpenGraph(
  store: StoreForSeo | null | undefined,
  opts: {
    title: string;
    description: string;
    url: string;
    image?: string | null;
    type?: "website" | "article";
  },
): NonNullable<Metadata["openGraph"]> {
  const og: NonNullable<Metadata["openGraph"]> = {
    title: opts.title,
    description: opts.description,
    type: opts.type ?? "website",
    url: opts.url,
    siteName: store?.name || "NUMU Store",
    locale: ogLocale(store),
  };
  if (opts.image) {
    og.images = [{ url: opts.image, alt: opts.title, width: 1200, height: 630 }];
  }
  return og;
}

/**
 * The OG product properties for a PDP, as `[property, content]` pairs the
 * caller renders as `<meta property=… />`.
 *
 * WHY these matter: Meta's crawler reads `og:type` + `product:*` to decide a
 * page is commerce. A PDP that declares `og:type=website` and carries no
 * product properties reads as generic content — which is how a clothing store
 * gets bucketed into an unrelated category and loses ad eligibility.
 *
 * WHY they can't go through Next's `metadata` object:
 *   - `openGraph.type: "product"` doesn't typecheck (Next's `OpenGraphType`
 *     union has no "product") and, worse, Next's metadata renderer switches
 *     over the known types and THROWS on anything else — "Invalid OpenGraph
 *     type" (E237) would 500 every PDP.
 *   - `other: {…}` renders `<meta name=…>`, but OGP properties must use
 *     `property=`.
 * So the route emits them itself; React hoists `<meta>` into <head> the same
 * way it hoists the PDP's existing `rel=preload` link.
 *
 * The caller must therefore NOT set `openGraph.type` — otherwise the page
 * carries two conflicting og:type tags.
 */
export function productOgProperties(opts: {
  /** Major units (the storefront's price convention), not cents. */
  price?: number | null;
  currency: string;
  inStock: boolean;
  /** The merchant's real SKU — never the product UUID. */
  sku?: string | null;
  brand?: string | null;
}): Array<[string, string]> {
  const tags: Array<[string, string]> = [["og:type", "product"]];
  if (typeof opts.price === "number" && Number.isFinite(opts.price)) {
    tags.push(["product:price:amount", String(opts.price)]);
    tags.push(["product:price:currency", opts.currency]);
  }
  // Meta's vocabulary is the spaced form, not schema.org's InStock.
  tags.push(["product:availability", opts.inStock ? "in stock" : "out of stock"]);
  const sku = (opts.sku ?? "").trim();
  if (sku) tags.push(["product:retailer_item_id", sku]);
  const brand = (opts.brand ?? "").trim();
  if (brand) tags.push(["product:brand", brand]);
  return tags;
}

export function buildTwitter(opts: {
  title: string;
  description: string;
  image?: string | null;
}): NonNullable<Metadata["twitter"]> {
  return {
    card: opts.image ? "summary_large_image" : "summary",
    title: opts.title,
    description: opts.description,
    ...(opts.image ? { images: [opts.image] } : {}),
  };
}

/**
 * Resolve which store a metadata route (sitemap.ts / robots.ts) is serving.
 *
 * These routes live under the `[domain]` segment but Next only supplies
 * `params` when the route also exports `generateSitemaps()`. Store subdomains
 * are created at runtime, so there is no fixed set to enumerate and no
 * `generateSitemaps()` — which means Next invokes the handler with NO
 * argument, and reading `params` off it throws.
 *
 * The request host is the reliable source: the proxy injects a canonical
 * `x-numu-host`, and every other server path resolves the store this way.
 *
 * @param params optional, honoured when Next does supply it
 * @param headerList the route's `await headers()`
 * @returns the subdomain (or a custom domain, passed through whole), or null
 */
export function resolveStoreDomainFromHeaders(
  headerList: { get(name: string): string | null },
): string | null {
  const raw = (
    headerList.get("x-numu-host") ||
    headerList.get("host") ||
    ""
  ).trim();
  if (!raw) return null;

  const hostname = raw.split(":")[0].toLowerCase();
  const platformDomain = (process.env.NUMU_PLATFORM_DOMAIN || "numueg.app")
    .split(":")[0]
    .toLowerCase();

  // `sub.numueg.app` / `sub.localhost` -> `sub`. A custom domain carries no
  // platform suffix to strip, so it passes through whole and
  // fetchStoreByDomain resolves it.
  if (hostname.endsWith(`.${platformDomain}`)) {
    return hostname.slice(0, -(platformDomain.length + 1)) || null;
  }
  // Dev convenience, mirroring the same rule in `proxy.ts`: `<sub>.localhost`
  // is always a subdomain. Without this the whole host was handed to
  // fetchStoreByDomain as if it were a CUSTOM domain, the lookup threw, and
  // the metadata routes swallowed it — `/sitemap.xml` silently degraded to its
  // three static URLs (no products, no collections, no blogs) and
  // `/robots.txt` rendered an error document. Every local SEO check was
  // therefore measuring the failure path.
  if (hostname.endsWith(".localhost")) {
    return hostname.slice(0, -".localhost".length) || null;
  }
  return hostname;
}
