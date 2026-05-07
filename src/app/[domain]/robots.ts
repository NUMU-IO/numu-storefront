import type { MetadataRoute } from "next";

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
