import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { fetchStoreByDomain } from "@/lib/api-client";
import { fetchBlogsList, fetchArticlesList } from "@/lib/blogs";
import {
  fetchSitemapCollections,
  fetchSitemapProducts,
} from "@/lib/sitemap-feed";
import {
  canonicalFor,
  resolveStoreDomainFromHeaders,
  storeBlocksIndexing,
  type StoreForSeo,
} from "@/lib/seo";

/**
 * Per-store sitemap.
 *
 * Next.js 16 reads `[domain]/sitemap.ts` as `<base>/<domain>/sitemap.xml`.
 * In production with subdomain routing the URL is rewritten to
 * `https://<sub>.numueg.app/sitemap.xml` by the edge layer.
 *
 * What we emit — only URLs a crawler is both ALLOWED to fetch and worth
 * indexing:
 *   - the home page and the two catalogue indexes `/products`, `/collections`
 *   - every product / collection that has a usable slug
 *   - every PUBLISHED CMS page (`/pages/<handle>`) that actually has a body
 *   - every store policy (`/policies/<handle>`) that actually has content
 *   - `/blogs`, each blog, and each published article
 *
 * What we deliberately do NOT emit:
 *   - `/cart`, `/search`, `/account`, `/checkout`. `robots.ts` disallows all
 *     of them, and a sitemap that advertises a disallowed URL is not being
 *     "complete", it is contradicting itself: Search Console reports the
 *     result as "Indexed, though blocked by robots.txt" / "Discovered –
 *     currently not indexed", and the crawl budget spent rediscovering those
 *     URLs comes out of the products' share. (`/cart` and `/search` used to
 *     be listed here "for completeness" — this note replaces that reasoning.)
 *   - pages and policies with an empty body. A URL that renders a heading
 *     over "No content yet." is a soft 404, and volunteering soft 404s is how
 *     a store's whole sitemap stops being trusted.
 *
 * Scale: Google's ceiling is 50,000 URLs / 50 MB uncompressed PER SITEMAP.
 * We cap the catalogue at PRODUCT_LIMIT, so the largest store today (~250
 * products) is two orders of magnitude below it. Crossing either limit means
 * splitting into a sitemap index via `generateSitemaps()` — not built yet on
 * purpose, because it also changes the emitted URL shape (`/sitemap/0.xml`)
 * and therefore the pointer `robots.ts` publishes.
 *
 * Catalogue discovery goes through `lib/sitemap-feed`, i.e. the backend's
 * purpose-built `/sitemap-feed` endpoint: TWO requests total, one per route
 * class. The previous path called `fetchProducts(storeId, PRODUCT_LIMIT)`,
 * which is capped at the public list endpoint's `limit<=100` and therefore
 * paged up to ten times, normalising every full product payload — variants,
 * images, currency coercion — so this file could read `slug` and `updated_at`
 * off it. That cost scaled with the catalogue while the output did not.
 *
 * Cache: Next.js will pre-render this on first request and revalidate with the
 * same tag-based scheme used by the feed / pages / blogs fetchers, so a publish
 * from the merchant hub triggers a cheap regeneration via the existing
 * revalidation path. The feed fetchers keep the store-wide `products:{id}` /
 * `categories:{id}` tags the old fetchers carried, so nothing that busted this
 * document before stops doing so.
 *
 * Failures are non-fatal — if the API is unreachable we still emit
 * the home URL so search engines don't see a 500.
 */

/**
 * Catalogue ceiling for one sitemap document. Well inside Google's 50,000-URL
 * limit (see the note above), and passed straight through as the feed's
 * `page_size` (whose own ceiling is 10,000), so the whole catalogue arrives in
 * a single request for every store we have.
 */
const PRODUCT_LIMIT = 1000;

interface SitemapProps {
  params?: Promise<{ domain: string }>;
}

/**
 * ⚠️ Next invokes this with NO ARGUMENT.
 *
 * A `sitemap.ts` inside a dynamic segment only receives `params` when the
 * route also exports `generateSitemaps()`. This one doesn't (there is no fixed
 * set of stores to enumerate — they're created at runtime), so Next called it
 * with `undefined` and destructuring `{ params }` threw before a single line
 * of the defensive code below could run:
 *
 *     TypeError: Cannot destructure property 'params' of 'undefined'
 *
 * That is why `/sitemap.xml` returned 500 on every store, in production,
 * silently — search engines could not discover a single product or collection
 * URL. The `props` parameter is therefore optional, and the store is resolved
 * from the request host (what the rest of the app does) rather than from
 * params.
 */
export default async function sitemap(
  props?: SitemapProps,
): Promise<MetadataRoute.Sitemap> {
  const domain = await resolveDomain(props?.params);
  if (!domain) return [];

  // Resolve the store first: it carries the id every catalogue query needs
  // AND — via `canonicalFor` — the host these URLs must be published under.
  let store: StoreForSeo | null = null;

  /**
   * Every URL goes through the SAME helper the pages' `<link rel=canonical>`
   * uses.
   *
   * This file used to build `https://<sub>.<platform>` by hand and explicitly
   * declined to look at `custom_domain`, on the theory that canonicals would
   * sort it out. They don't sort out a contradiction: on a custom-domain store
   * every sitemap entry pointed at the subdomain host while the page it
   * pointed at declared the custom domain as its real self, so Google was
   * being handed a duplicate-content split by the very document meant to
   * prevent one. `canonicalOriginFor` (which `canonicalFor` wraps) gates on
   * `settings.custom_domain.status === "active"`, so an unverified domain
   * can't hijack the sitemap either. In dev it yields the path-segment form
   * (`http://localhost:3100/<domain>/…`), which is likewise exactly what the
   * pages emit, so a local SEO check compares like with like.
   */
  const urlFor = (path: string) => canonicalFor(store, domain, path);

  const homeEntry = (): MetadataRoute.Sitemap[number] => ({
    url: urlFor("/"),
    changeFrequency: "daily",
    priority: 1.0,
    lastModified: new Date(),
  });

  /**
   * What we can honestly publish when the store never resolved.
   *
   * With no store row there is no `subdomain`/`custom_domain` for
   * `canonicalFor` to read, so it falls back to gluing the platform domain
   * onto whatever it was handed. For a bare subdomain that still lands on the
   * right host. For a CUSTOM hostname (which the resolver passes through
   * whole, since there is no platform suffix to strip) it produces
   * `https://shop.example.com.numueg.app/` — a host that does not exist. An
   * empty `<urlset>` is a perfectly fine thing for a crawler to read and
   * removes nothing already indexed; a sitemap containing one dead URL is
   * worse than saying nothing.
   */
  const degraded = (): MetadataRoute.Sitemap =>
    domain.includes(".") ? [] : [homeEntry()];

  try {
    store = (await fetchStoreByDomain(domain)) as unknown as StoreForSeo;
  } catch (err) {
    // Non-fatal by design — a 500 here is worse than a thin sitemap. But it
    // must not be SILENT: a store that fails to resolve degrades to the home
    // URL alone (or nothing), which reads like "this store has no products"
    // rather than "the lookup broke". That is how a resolver gap went
    // unnoticed until someone counted the <loc> elements.
    console.error("[sitemap] store resolution failed", { domain, err });
    return degraded();
  }
  const storeId = store?.id;
  if (!storeId) {
    console.error("[sitemap] store resolved without an id", { domain });
    return degraded();
  }

  // Indexing gate — a suspended / opted-out store gets an empty sitemap so
  // search engines have no URLs to crawl (pairs with robots.ts Disallow: /).
  if (storeBlocksIndexing(store)) return [];

  const entries: MetadataRoute.Sitemap = [homeEntry()];

  const [products, collections, pages] = await Promise.all([
    fetchSitemapProducts(storeId, PRODUCT_LIMIT).catch(() => []),
    fetchSitemapCollections(storeId).catch(() => []),
    fetchPublishedPages(storeId),
  ]);

  // The two catalogue index pages. Gated on there being something to list:
  // an empty /products grid is a thin page, and the same fetch failure that
  // would empty the grid has already emptied the per-item entries below, so
  // the gate never hides an index that has content behind it.
  if (products.length > 0) {
    entries.push({
      url: urlFor("/products"),
      changeFrequency: "daily",
      priority: 0.8,
    });
  }
  if (collections.length > 0) {
    entries.push({
      url: urlFor("/collections"),
      changeFrequency: "weekly",
      priority: 0.7,
    });
  }

  for (const p of products) {
    // A missing OR whitespace-only slug emits `/products/`, i.e. a guaranteed
    // 404 inside the one document whose entire job is to promise these URLs
    // resolve. `!p?.slug` alone let `" "` through.
    const slug = (p?.slug ?? "").trim();
    if (!slug) continue;
    entries.push({
      url: urlFor(`/products/${encodeURIComponent(slug)}`),
      changeFrequency: "weekly",
      priority: 0.8,
      lastModified: parseDate(p.updated_at),
    });
  }
  // `lastModified` on a collection is newly POPULATED, not newly read: this
  // loop always asked for `c.updated_at`, but `/categories` — the payload it
  // used to iterate — carries no timestamp at all, so every collection entry
  // shipped without a `<lastmod>`. The sitemap feed serialises the real
  // `updated_at`, so the field the code always intended now has a value.
  for (const c of collections) {
    const slug = (c?.slug ?? "").trim();
    if (!slug) continue;
    entries.push({
      url: urlFor(`/collections/${encodeURIComponent(slug)}`),
      changeFrequency: "weekly",
      priority: 0.6,
      lastModified: parseDate(c.updated_at),
    });
  }

  // Published CMS pages. No `lastModified`: the public payload carries no
  // timestamp, and stamping `new Date()` on every regeneration would tell
  // crawlers the whole content set changes hourly — a claim that gets the
  // field ignored site-wide once it proves false.
  for (const page of pages) {
    const handle = (page?.handle ?? "").trim();
    if (!handle || !hasBody(page?.body)) continue;
    entries.push({
      url: urlFor(`/pages/${encodeURIComponent(handle)}`),
      changeFrequency: "monthly",
      priority: 0.4,
    });
  }

  for (const handle of publishedPolicyHandles(store)) {
    entries.push({
      url: urlFor(`/policies/${encodeURIComponent(handle)}`),
      changeFrequency: "yearly",
      priority: 0.3,
    });
  }

  // Blogs + published articles (phase-3: articles ship sitemap-included
  // from day 1). Failures are non-fatal like everything else here.
  const blogs = await fetchBlogsList(storeId).catch(() => []);
  if (blogs.length > 0) {
    entries.push({
      url: urlFor("/blogs"),
      changeFrequency: "weekly",
      priority: 0.5,
    });
  }
  for (const b of blogs) {
    if (!b?.handle) continue;
    entries.push({
      url: urlFor(`/blogs/${encodeURIComponent(b.handle)}`),
      changeFrequency: "weekly",
      priority: 0.5,
    });
    const articles = await fetchArticlesList(storeId, b.handle).catch(() => []);
    for (const a of articles) {
      if (!a?.handle) continue;
      entries.push({
        url: urlFor(
          `/blogs/${encodeURIComponent(b.handle)}/${encodeURIComponent(a.handle)}`,
        ),
        changeFrequency: "monthly",
        priority: 0.6,
        lastModified: parseDate(a.published_at),
      });
    }
  }

  return entries;
}

/**
 * Which store is this sitemap for?
 *
 * `params` is preferred when Next actually supplies it, but it usually won't
 * (see the note on the default export), so the real source is the request
 * host — the proxy already injects a canonical `x-numu-host`, and every other
 * server path in the app resolves the store the same way.
 */
async function resolveDomain(
  params?: Promise<{ domain: string }>,
): Promise<string | null> {
  if (params) {
    try {
      const resolved = await params;
      if (resolved?.domain) return resolved.domain;
    } catch {
      // fall through to the host header
    }
  }
  return resolveStoreDomainFromHeaders(await headers());
}

/**
 * `lastModified`, but never an invalid one.
 *
 * `new Date("")` / `new Date("0000-00-00")` yields an Invalid Date, and Next
 * calls `.toISOString()` on whatever we hand it — which throws a RangeError
 * and turns the whole sitemap back into the 500 this file exists to have
 * fixed. One malformed `updated_at` on one product is not worth that.
 */
function parseDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

interface PublishedPage {
  handle?: string | null;
  /** Bilingual body ({en, ar}) as stored by the hub's page editor. */
  body?: Record<string, string> | null;
}

/**
 * Published CMS pages for the store.
 *
 * `api-client` only exposes a BY-HANDLE fetcher (`fetchStorePage`), because
 * every other route already knows the handle it wants; the sitemap is the one
 * caller that has to ENUMERATE. `GET /storefront/store/{id}/pages`
 * (published-only, the list endpoint the same router serves) is the only
 * complete source: deriving handles from the nav menus instead would silently
 * omit precisely the pages that most need a sitemap — the ones nothing links
 * to.
 *
 * Tagged `pages-{storeId}`, the same tag `fetchStorePage` uses and the backend
 * busts on publish, so publishing a page regenerates the sitemap along with
 * the page itself. Timed out for the same reason api-client bounds its calls:
 * a hung upstream must not pin the render.
 *
 * Any failure resolves to `[]` — a sitemap missing its CMS pages is a much
 * smaller problem than a sitemap that 500s.
 */
async function fetchPublishedPages(storeId: string): Promise<PublishedPage[]> {
  const apiUrl = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";
  try {
    const res = await fetch(`${apiUrl}/storefront/store/${storeId}/pages`, {
      next: { tags: [`pages-${storeId}`], revalidate: 120 },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return [];
    const body = await res.json();
    const data = body?.data ?? body;
    return Array.isArray(data) ? (data as PublishedPage[]) : [];
  } catch {
    return [];
  }
}

/**
 * Does this bilingual body hold anything a reader would call content?
 *
 * The hub's rich-text editor persists an EMPTY document as markup, not as ""
 * — `<p></p>`, `<p><br></p>`, a stray `&nbsp;` — so a plain truthiness check
 * happily lists pages that render as a heading over blank space, which is the
 * soft-404 shape Google penalises. Strip tags and entities and look for real
 * characters; a media-only body (a lookbook image, an embedded video) counts
 * too, since that is genuine content that happens to carry no text.
 */
function hasBody(body: Record<string, string> | null | undefined): boolean {
  if (!body || typeof body !== "object") return false;
  return Object.values(body).some((value) => {
    if (typeof value !== "string") return false;
    if (/<(img|iframe|video|picture|source)\b/i.test(value)) return true;
    const text = value
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .trim();
    return text.length > 0;
  });
}

/** The `/policies/[handle]` route 404s any handle that isn't a simple slug. */
const POLICY_HANDLE_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Policy handles the store has actually written something for.
 *
 * Read from `store.settings.policies` — the same source, with the same
 * emptiness test (`typeof body === "string" && body.trim()`), that
 * `/policies/[handle]`'s own `readPolicy` uses. Matching it exactly is the
 * point: any looser test lists a URL the route renders as "This policy hasn't
 * been published yet", and handles that fail the route's slug guard are
 * skipped rather than emitted as certain 404s.
 */
function publishedPolicyHandles(store: StoreForSeo | null): string[] {
  const policies = (
    store?.settings as Record<string, unknown> | null | undefined
  )?.policies;
  if (!policies || typeof policies !== "object" || Array.isArray(policies)) {
    return [];
  }
  return Object.entries(policies as Record<string, unknown>)
    .filter(
      ([handle, body]) =>
        POLICY_HANDLE_RE.test(handle) &&
        typeof body === "string" &&
        body.trim().length > 0,
    )
    .map(([handle]) => handle);
}
