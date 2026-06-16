import type { MetadataRoute } from "next";
import { fetchStoreByDomain } from "@/lib/api-client";
import { storeBlocksIndexing, type StoreForSeo } from "@/lib/seo";

/**
 * Per-store robots.txt.
 *
 * Blocks crawlers from internal + transactional paths (cart, account,
 * checkout, search) and points them at the store's sitemap.xml. The
 * actual sitemap entry list lives in sitemap.ts.
 *
 * One nuance: in development we run on path-segment routing
 * (`localhost:3000/<sub>/sitemap.xml`), but in production the edge
 * rewrites subdomain → path so the sitemap URL emitted here must be
 * the user-facing one. We therefore always emit the production form
 * when NEXT_PUBLIC_NUMU_ENV=production; in dev we point at the
 * path-segment URL so wget/curl from the same host can grab it.
 */

interface RobotsProps {
  params: Promise<{ domain: string }>;
}

export default async function robots({
  params,
}: RobotsProps): Promise<MetadataRoute.Robots> {
  const { domain } = await params;
  const platformDomain = process.env.NUMU_PLATFORM_DOMAIN || "numueg.app";
  const isProd = process.env.NEXT_PUBLIC_NUMU_ENV === "production";
  const sitemapUrl = isProd
    ? `https://${domain}.${platformDomain}/sitemap.xml`
    : `http://localhost:3000/${domain}/sitemap.xml`;

  // Indexing gate: a suspended / inactive / pending store, or a merchant who
  // turned indexing off, must not be crawlable. A failed lookup is treated as
  // permissive — only block when the store resolved AND blocks indexing, so a
  // transient API blip can't de-index a live store.
  let store: StoreForSeo | null = null;
  try {
    store = (await fetchStoreByDomain(domain)) as unknown as StoreForSeo;
  } catch {
    store = null;
  }
  if (store && storeBlocksIndexing(store)) {
    return {
      rules: [{ userAgent: "*", disallow: "/" }],
      host: domain,
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/cart",
          "/checkout",
          "/account",
          "/account/*",
          "/search",
          "/api/",
          "/_next/",
        ],
      },
    ],
    sitemap: sitemapUrl,
  };
}
