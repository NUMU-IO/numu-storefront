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
  } | null;
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
  const p = canonicalPath(path);
  // The root keeps its trailing slash: that is the form the store is linked
  // and indexed under, and `metadataBase` is built from the same string.
  return p ? `${origin}${p}` : `${origin}/`;
}

/** hreflang value → the locale URL prefix `proxy.ts` resolves. The proxy
 *  strips a leading 2-letter segment and stamps `x-numu-locale`, so `/ar/...`
 *  is the path-prefixed form the storefront actually serves (the `?locale=`
 *  query works too, but a query-string alternate is far weaker to crawlers).
 *  Every NUMU store is en/ar bilingual by construction (LocalizedString), so
 *  both entries always exist. */
const HREFLANG_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ["en-EG", "en"],
  ["ar-EG", "ar"],
];

/**
 * `alternates` for a route: the per-URL canonical plus en/ar hreflang.
 *
 * Arabic is where Egyptian shoppers actually search, and the storefront has
 * served full ar content (og:locale already emits ar_EG) without ever telling
 * a crawler the Arabic URL exists.
 *
 * ⚠️ `x-default` and the canonical are the UN-prefixed URL, which serves the
 * store's own `default_language`. The Arabic URL therefore consolidates into
 * the un-prefixed one rather than self-canonicalising — `proxy.ts` strips the
 * locale prefix before stamping `x-numu-pathname`, so a shared layout cannot
 * reconstruct `/ar/...` for the current request. Making each locale
 * self-canonical needs the proxy to stamp the pre-strip pathname too.
 */
export function alternatesFor(
  store: StoreForSeo | null | undefined,
  domain: string,
  path?: string | null,
): NonNullable<Metadata["alternates"]> {
  const canonical = canonicalFor(store, domain, path);
  const origin = canonicalOriginFor(store, domain);
  const p = canonicalPath(path);
  const languages: Record<string, string> = {};
  for (const [hreflang, prefix] of HREFLANG_PREFIXES) {
    languages[hreflang] = `${origin}/${prefix}${p}`;
  }
  languages["x-default"] = canonical;
  return { canonical, languages };
}

/**
 * The visitor-facing path of the current request, from the pathname the proxy
 * stamps on every storefront response (`x-numu-pathname`, e.g.
 * `/vionne/products/aisha-scarf`).
 *
 * A layout's `generateMetadata` never sees the child route's params, so this
 * header is the only channel through which the shared `[domain]` layout can
 * emit a per-URL canonical instead of one origin for the whole subtree.
 * Falls back to "/" when the header is missing (a request that reached the app
 * without passing through the proxy).
 */
export function visitorPathFromHeaders(
  headerList: { get(name: string): string | null },
  domain: string,
): string {
  const raw = (headerList.get("x-numu-pathname") ?? "").trim();
  if (!raw) return "/";
  // Strip the tenant segment only on a real segment boundary: a bare
  // `startsWith("/" + domain)` also matches a different store whose subdomain
  // merely starts with this one (`/vionne` vs `/vionne-outlet`).
  const prefix = `/${domain}`;
  if (raw === prefix) return "/";
  if (raw.startsWith(`${prefix}/`)) return raw.slice(prefix.length);
  return raw;
}

export function storeSeoTitle(store: StoreForSeo | null | undefined): string {
  return (store?.seo?.seo_title || store?.name || "NUMU Store").trim();
}

export function storeSeoDescription(store: StoreForSeo | null | undefined): string {
  const explicit = (store?.seo?.seo_description ?? "").trim();
  if (explicit) return explicit;
  const desc = (store?.description ?? "").trim();
  if (desc) return desc;
  const name = (store?.name ?? "").trim() || "NUMU";
  const ar = (store?.default_language ?? "").toLowerCase() === "ar";
  return ar
    ? `تسوّق من ${name} — تشكيلة مختارة وتوصيل لكل محافظات مصر، والدفع عند الاستلام متاح.`
    : `Shop ${name} — a curated selection with shipping across Egypt. Cash on delivery available.`;
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
