import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { fetchStoreByDomain } from "@/lib/api-client";
import {
  resolveStoreDomainFromHeaders,
  storeBlocksIndexing,
  type StoreForSeo,
} from "@/lib/seo";

/** Shared with sitemap.ts — see resolveStoreDomainFromHeaders for why. */
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
  params?: Promise<{ domain: string }>;
}

/**
 * Same caveat as `sitemap.ts`: Next calls this with NO ARGUMENT unless the
 * route exports `generateSitemaps()`, so `params` is optional and the store is
 * resolved from the request host. Destructuring `{ params }` here would throw
 * exactly as it did in the sitemap.
 */
export default async function robots(
  props?: RobotsProps,
): Promise<MetadataRoute.Robots> {
  const domain = await resolveDomain(props?.params);
  const platformDomain = process.env.NUMU_PLATFORM_DOMAIN || "numueg.app";
  const isProd = process.env.NEXT_PUBLIC_NUMU_ENV === "production";

  // No resolvable store: emit a permissive default rather than throwing. A
  // 500 here is worse than a slightly wrong robots.txt — crawlers treat an
  // errored robots.txt as "do not crawl this site at all".
  if (!domain) {
    return { rules: [{ userAgent: "*", allow: "/" }] };
  }

  const h = await headers();
  const sitemapUrl = isProd
    ? `https://${domain}.${platformDomain}/sitemap.xml`
    : `http://${(h.get("host") || "localhost:3100").trim()}/sitemap.xml`;

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
