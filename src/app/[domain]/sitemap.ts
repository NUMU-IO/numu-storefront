import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import {
  fetchStoreByDomain,
  fetchProducts,
  fetchCollections,
} from "@/lib/api-client";
import { fetchBlogsList, fetchArticlesList } from "@/lib/blogs";
import {
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
 * What we emit:
 *   - The store's home (`/`)
 *   - The CMS pages we know are reachable (about/contact/etc. — the
 *     real CMS pages backend doesn't exist yet, so we emit the common
 *     handles themes typically link to in their nav menus)
 *   - All products under `/products/<slug>`
 *   - All collections under `/collections/<slug>`
 *   - `/cart`, `/search`, `/account` (low priority — search engines
 *     should not crawl /cart or /account but we list them for
 *     completeness; robots.ts disallows crawling those paths)
 *
 * Cache: Next.js will pre-render this on first request and revalidate
 * with the same tag-based scheme used by `fetchProducts` /
 * `fetchCollections`, so a publish from the merchant hub triggers
 * a cheap regeneration via the existing revalidation path.
 *
 * Failures are non-fatal — if the API is unreachable we still emit
 * the home URL so search engines don't see a 500.
 */

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
  const baseUrl = await resolveBaseUrl(domain);

  const entries: MetadataRoute.Sitemap = [
    {
      url: baseUrl,
      changeFrequency: "daily",
      priority: 1.0,
      lastModified: new Date(),
    },
    {
      url: `${baseUrl}/cart`,
      changeFrequency: "never",
      priority: 0.1,
    },
    {
      url: `${baseUrl}/search`,
      changeFrequency: "yearly",
      priority: 0.2,
    },
  ];

  // Try to load the store first so we have an id for the catalog
  // queries; failures are non-fatal — return what we have.
  let store: { id?: string } | null = null;
  try {
    store = await fetchStoreByDomain(domain);
  } catch (err) {
    // Non-fatal by design — a 500 here is worse than a thin sitemap. But it
    // must not be SILENT: a store that fails to resolve degrades to exactly
    // the three static URLs above, which reads like "this store has no
    // products" rather than "the lookup broke". That is how a resolver gap
    // went unnoticed until someone counted the <loc> elements.
    console.error("[sitemap] store resolution failed", { domain, err });
    return entries;
  }
  if (!store?.id) {
    console.error("[sitemap] store resolved without an id", { domain });
    return entries;
  }

  // Indexing gate — a suspended / opted-out store gets an empty sitemap so
  // search engines have no URLs to crawl (pairs with robots.ts Disallow: /).
  if (storeBlocksIndexing(store as unknown as StoreForSeo)) return [];

  const [products, collections] = await Promise.all([
    fetchProducts(store.id, 1000).catch(() => []),
    fetchCollections(store.id).catch(() => []),
  ]);

  for (const p of products as Array<{ slug?: string; updated_at?: string }>) {
    if (!p?.slug) continue;
    entries.push({
      url: `${baseUrl}/products/${encodeURIComponent(p.slug)}`,
      changeFrequency: "weekly",
      priority: 0.8,
      lastModified: p.updated_at ? new Date(p.updated_at) : undefined,
    });
  }
  for (const c of collections as Array<{ slug?: string; updated_at?: string }>) {
    if (!c?.slug) continue;
    entries.push({
      url: `${baseUrl}/collections/${encodeURIComponent(c.slug)}`,
      changeFrequency: "weekly",
      priority: 0.6,
      lastModified: c.updated_at ? new Date(c.updated_at) : undefined,
    });
  }

  // Blogs + published articles (phase-3: articles ship sitemap-included
  // from day 1). Failures are non-fatal like everything else here.
  const blogs = await fetchBlogsList(store.id).catch(() => []);
  if (blogs.length > 0) {
    entries.push({
      url: `${baseUrl}/blogs`,
      changeFrequency: "weekly",
      priority: 0.5,
    });
  }
  for (const b of blogs) {
    if (!b?.handle) continue;
    entries.push({
      url: `${baseUrl}/blogs/${encodeURIComponent(b.handle)}`,
      changeFrequency: "weekly",
      priority: 0.5,
    });
    const articles = await fetchArticlesList(store.id, b.handle).catch(
      () => [],
    );
    for (const a of articles) {
      if (!a?.handle) continue;
      entries.push({
        url: `${baseUrl}/blogs/${encodeURIComponent(b.handle)}/${encodeURIComponent(a.handle)}`,
        changeFrequency: "monthly",
        priority: 0.6,
        lastModified: a.published_at ? new Date(a.published_at) : undefined,
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
 * Compute the storefront base URL for the given subdomain. Production:
 *   `https://<subdomain>.<NUMU_PLATFORM_DOMAIN>` (or the store's
 *   custom domain if configured). Dev: whatever Next is running under,
 *   path-segment routed.
 */
async function resolveBaseUrl(domain: string): Promise<string> {
  const platformDomain = process.env.NUMU_PLATFORM_DOMAIN || "numueg.app";
  const isProd = process.env.NEXT_PUBLIC_NUMU_ENV === "production";
  if (isProd) {
    // We could check store.custom_domain here for a canonical URL on
    // custom-domain stores, but the sitemap reachability matters more
    // than the exact host: search engines deduplicate via
    // <link rel="canonical"> on the rendered pages.
    return `https://${domain}.${platformDomain}`;
  }
  // Dev: use the host the request actually arrived on. This used to be
  // hardcoded to `localhost:3000` on the assumption that the request host was
  // unavailable here — it isn't, and the storefront runs on 3100 anyway, so
  // every dev sitemap URL pointed at a port with nothing on it.
  const h = await headers();
  const host = (h.get("host") || "localhost:3100").trim();
  return `http://${host}`;
}
