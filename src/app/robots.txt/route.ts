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
  canonicalOriginFor,
  resolveStoreDomainFromHeaders,
  storeAllowsAiCrawlers,
  storeAllowsAiTraining,
  storeBlocksIndexing,
  type StoreForSeo,
} from "@/lib/seo";

export const dynamic = "force-dynamic";

/**
 * Cloudflare's Content Signals policy, expressed per RFC 9309 as an extension
 * directive inside the `User-Agent: *` group.
 *
 * No longer hardcoded — both halves are the store's now, which is what the
 * note that used to sit here asked for.
 *
 *   search    — the store is indexable at all. Already gated by
 *               `storeBlocksIndexing`; a store that blocks indexing never
 *               reaches this line.
 *   ai-input  — `seo.ai_crawlers_allowed`, default yes. Being read to answer
 *               a shopper's question is distribution for a shop.
 *   ai-train  — `seo.ai_training_allowed`, default NO. Kept separate from
 *               ai-input on purpose: a merchant can rationally let an
 *               assistant read the catalogue to recommend them, and still
 *               refuse to have their photography absorbed into model weights.
 *               The default stays what it was platform-wide; the difference
 *               is that a merchant can now change it.
 */
function contentSignal(aiAllowed: boolean, trainAllowed: boolean): string {
  return [
    "search=yes",
    `ai-input=${aiAllowed ? "yes" : "no"}`,
    `ai-train=${trainAllowed ? "yes" : "no"}`,
  ].join(", ");
}

/**
 * Crawlers that read a page to answer a question, or to train on it.
 *
 * Content-Signal states the policy; these groups enforce it. Several of these
 * agents read `Disallow` and ignore extension directives entirely, so a
 * merchant who opts out and gets only a Content-Signal line has opted out of
 * nothing. Listing them explicitly is the half that actually binds.
 */
const AI_CRAWLERS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "PerplexityBot",
  "Google-Extended",
  "CCBot",
  "Applebot-Extended",
  "meta-externalagent",
];

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
  const isProd = process.env.NEXT_PUBLIC_NUMU_ENV === "production";

  // No resolvable store: emit a permissive default rather than throwing. A 500
  // here is worse than a slightly wrong robots.txt — crawlers treat an errored
  // robots.txt as "do not crawl this site at all".
  if (!domain) {
    return textResponse(
      [
        "User-Agent: *",
        `Content-Signal: ${contentSignal(true, false)}`,
        "Allow: /",
        "",
      ].join("\n"),
    );
  }

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

  // Built AFTER the store is fetched, and via canonicalOriginFor, because a
  // custom domain is already a complete host. The previous form appended the
  // platform domain unconditionally:
  //
  //     `https://${domain}.${platformDomain}/sitemap.xml`
  //
  // which is right for a subdomain store (`vionne` -> vionne.numueg.app) and
  // produced `https://vionneeg.com.numueg.app/sitemap.xml` for the first
  // merchant to connect their own domain — a host that does not resolve, so
  // the sitemap was undiscoverable on exactly the domain meant to rank.
  // canonicalOriginFor also refuses a custom domain whose status is not active,
  // so an unverified hostname can never leak into robots.txt.
  const sitemapUrl = isProd
    ? `${canonicalOriginFor(store, domain)}/sitemap.xml`
    : `http://${(req.headers.get("host") || "localhost:3100").trim()}/sitemap.xml`;

  // A store that opted out gets an explicit Disallow per agent. Several of
  // these read Disallow and ignore extension directives entirely, so a
  // merchant given only a Content-Signal line has opted out of nothing.
  const aiAllowed = storeAllowsAiCrawlers(store);
  const trainAllowed = storeAllowsAiTraining(store);
  const aiGroups = aiAllowed
    ? []
    : AI_CRAWLERS.flatMap((agent) => [`User-Agent: ${agent}`, "Disallow: /", ""]);

  return textResponse(
    [
      "User-Agent: *",
      `Content-Signal: ${contentSignal(aiAllowed, trainAllowed)}`,
      "Allow: /",
      ...DISALLOW.map((path) => `Disallow: ${path}`),
      "",
      ...aiGroups,
      `Sitemap: ${sitemapUrl}`,
      "",
    ].join("\n"),
  );
}
