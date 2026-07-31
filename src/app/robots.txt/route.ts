/**
 * Per-store robots.txt.
 *
 * ⚠️ This route MUST live at the app root, not under `[domain]/`. Next treats
 * `sitemap` as a segment-aware metadata convention (that's what
 * `generateSitemaps()` is for) but resolves robots only from the app root.
 * Nested, it was never routed at all: every `/robots.txt` — on the subdomain
 * host AND the path-routing host — fell through to the catch-all and returned a
 * Next *error document*, which crawlers read as "this site has no robots.txt
 * and something is broken". The store is resolved from the request host anyway,
 * so the root position costs nothing.
 *
 * ── Why a Route Handler instead of `app/robots.ts` ─────────────────────────
 * This replaces the `MetadataRoute.Robots` export. That type models only
 * userAgent / allow / disallow / crawlDelay / host / sitemap, and there is no
 * escape hatch for an arbitrary directive — so `Content-Signal` (WP9.2) cannot
 * be expressed through it at all. The emitted text below is otherwise
 * line-for-line what the metadata export produced.
 *
 * Blocks crawlers from internal + transactional paths (cart, account,
 * checkout, search) and points them at the store's sitemap.xml. The actual
 * sitemap entry list lives in `[domain]/sitemap.ts`.
 *
 * One nuance: in development we run on path-segment routing
 * (`localhost:3100/<sub>/sitemap.xml`), but in production the edge rewrites
 * subdomain → path, so the sitemap URL emitted here must be the user-facing
 * one. We therefore always emit the production form when
 * NEXT_PUBLIC_NUMU_ENV=production; in dev we point at the path-segment URL so
 * curl from the same host can grab it.
 */

import { NextRequest } from "next/server";
import { fetchStoreByDomain } from "@/lib/api-client";
import {
  resolveStoreDomainFromHeaders,
  storeBlocksIndexing,
  type StoreForSeo,
} from "@/lib/seo";

export const dynamic = "force-dynamic";

/**
 * Cloudflare's Content Signals policy, expressed per RFC 9309 as an extension
 * directive inside the `User-Agent: *` group.
 *
 *   search    = yes — this is a shop that wants to be found.
 *   ai-input  = yes — answer engines and AI shopping agents MAY read the
 *                     catalog to answer a shopper's question. For a store,
 *                     that is distribution, not leakage.
 *   ai-train  = no  — merchant product photography and copy are not training
 *                     data. This is the one signal a merchant loses by default
 *                     if we say nothing.
 *
 * ⚠️ PLATFORM-WIDE DEFAULT, hardcoded. It applies to `rabbit` exactly as it
 * applies to `vionne`. This is defensible as a default for a commerce
 * storefront, but it is genuinely a merchant policy choice and belongs in store
 * settings (alongside the existing indexing toggle read by
 * `storeBlocksIndexing`) rather than in code. Flagged in the remediation plan;
 * not built here because the setting does not exist in the API yet.
 */
const CONTENT_SIGNAL = "search=yes, ai-input=yes, ai-train=no";

const DISALLOW = [
  "/cart",
  "/checkout",
  "/account",
  "/account/*",
  "/search",
  "/api/",
  "/_next/",
];

function textResponse(body: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=86400",
    },
  });
}

export async function GET(req: NextRequest): Promise<Response> {
  const domain = resolveStoreDomainFromHeaders(req.headers);
  const platformDomain = process.env.NUMU_PLATFORM_DOMAIN || "numueg.app";
  const isProd = process.env.NEXT_PUBLIC_NUMU_ENV === "production";

  // No resolvable store: emit a permissive default rather than throwing. A 500
  // here is worse than a slightly wrong robots.txt — crawlers treat an errored
  // robots.txt as "do not crawl this site at all".
  if (!domain) {
    return textResponse(
      ["User-Agent: *", `Content-Signal: ${CONTENT_SIGNAL}`, "Allow: /", ""].join(
        "\n",
      ),
    );
  }

  const sitemapUrl = isProd
    ? `https://${domain}.${platformDomain}/sitemap.xml`
    : `http://${(req.headers.get("host") || "localhost:3100").trim()}/sitemap.xml`;

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
    // No Content-Signal here on purpose: a store that is asking not to be
    // indexed at all has no use for a "yes, read me" signal.
    return textResponse(
      ["User-Agent: *", "Disallow: /", "", `Host: ${domain}`, ""].join("\n"),
    );
  }

  return textResponse(
    [
      "User-Agent: *",
      `Content-Signal: ${CONTENT_SIGNAL}`,
      "Allow: /",
      ...DISALLOW.map((path) => `Disallow: ${path}`),
      "",
      `Sitemap: ${sitemapUrl}`,
      "",
    ].join("\n"),
  );
}
