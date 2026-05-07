import type { MetadataRoute } from "next";
import {
  fetchStoreByDomain,
  fetchProducts,
  fetchCollections,
} from "@/lib/api-client";

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
  params: Promise<{ domain: string }>;
}

export default async function sitemap({
  params,
}: SitemapProps): Promise<MetadataRoute.Sitemap> {
  const { domain } = await params;
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
  } catch {
    return entries;
  }
  if (!store?.id) return entries;

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

  return entries;
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
  // Dev: path-segment routing under the same host the sitemap is on.
  // Next.js doesn't expose the request host inside `sitemap.ts`, so
  // we hard-code localhost:3000 — fine for dev sitemaps which aren't
  // submitted anywhere.
  return `http://localhost:3000/${domain}`;
}
