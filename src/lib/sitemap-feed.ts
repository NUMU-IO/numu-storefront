import { cache } from "react";
import { ApiFetchError } from "@/lib/api-client";

/**
 * Lean catalogue feed for sitemap generation.
 *
 * Backed by the one backend endpoint built for this caller:
 *   GET /storefront/store/{store_id}/sitemap-feed?type=products
 *       -> { items: [{id, slug, updated_at, first_image}], total, page, page_size }
 *   GET /storefront/store/{store_id}/sitemap-feed?type=categories
 *       -> { items: [{id, slug, name, updated_at}], total, page, page_size }
 *
 * Why not reuse `fetchProducts` / `fetchCollections`:
 * `[domain]/sitemap.ts` needs exactly two fields per row — a slug and a
 * timestamp — and `fetchProducts` is the wrong shape for that twice over. It
 * caps at the public list endpoint's `limit<=100`, so a 1000-product ceiling
 * means TEN sequential-ish round trips; and every one of those pages ships the
 * full ProductResponse (descriptions, variants, images, prices) which
 * `normalizeProduct` then walks to coerce currencies and image objects that
 * nothing in the sitemap ever reads. This endpoint answers the same question in
 * one request whose rows are already dicts on the server side (see
 * `ProductRepository.list_sitemap_feed`).
 *
 * Filtering is server-side and matches what the old path got: the products
 * branch selects `status == ACTIVE` (the same predicate `/products?is_active=1`
 * resolves to), and the categories branch runs `ListCategoriesUseCase` with
 * `include_inactive=False`, i.e. the identical call `/categories` makes. The
 * feed rows carry no `status` field at all, so there is nothing to re-filter
 * here — and nothing that needs it.
 *
 * Cache tags: each fetch carries BOTH the sitemap-specific tag and the
 * store-wide catalogue tag. The store-wide one (`products:{id}` /
 * `categories:{id}`) is what busts the sitemap today via `fetchProducts` /
 * `fetchCollections`, so keeping it preserves current freshness exactly. The
 * `sitemap:*` pair is what NUMU-api has been posting all along
 * (`revalidate_on_product_change`, `revalidate_on_category_change`) with no
 * subscriber on this side — which also left `revalidate_sitemaps()`, the
 * sitemap-only helper for bulk flows that posts NOTHING else, unable to
 * invalidate anything at all. Subscribing here makes that path real.
 */

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

/**
 * Same 5s ceiling every other backend read in the storefront uses
 * (`api-client`'s DEFAULT_TIMEOUT_MS, and the sitemap's own pages fetch): a
 * read that hasn't answered in 5s is a hung upstream, not a slow-but-healthy
 * one. Comfortable for this endpoint — the rows come out of a single projected
 * SELECT, no per-row serialisation.
 */
const FEED_TIMEOUT_MS = 5_000;

/** Backend-enforced ceiling on `page_size` (Query(ge=1, le=10000)). */
const FEED_PAGE_SIZE_MAX = 10_000;

/** One product row, as the feed serialises it. */
export interface SitemapProductEntry {
  id: string;
  slug: string | null;
  updated_at: string | null;
  /**
   * First usable image URL. Unused by the current sitemap — we emit no
   * `<image:image>` extension — but part of the endpoint's contract, so it is
   * typed rather than silently dropped.
   */
  first_image: string | null;
}

/** One collection row. NUMU categories ARE the storefront's collections. */
export interface SitemapCollectionEntry {
  id: string;
  slug: string | null;
  name: string | null;
  updated_at: string | null;
}

interface SitemapFeedPayload<T> {
  items?: T[];
  total?: number;
  page?: number;
  page_size?: number;
}

/**
 * One feed request. Mirrors `api-client`'s `apiFetch` (which is module-private,
 * so this cannot import it): same timeout wrapper, same `next.tags/revalidate`
 * options, same `{success, data, message}` unwrapping, same `ApiFetchError` so
 * callers see one failure type across both modules.
 */
async function fetchFeed<T>(
  storeId: string,
  type: "products" | "categories",
  params: { pageSize?: number; tags: string[]; revalidate: number },
): Promise<T[]> {
  const qs = new URLSearchParams({ type });
  if (params.pageSize != null) {
    qs.set("page_size", String(Math.min(params.pageSize, FEED_PAGE_SIZE_MAX)));
  }
  const url = `${API_URL}/storefront/store/${storeId}/sitemap-feed?${qs}`;

  let res: Response;
  try {
    res = await fetch(url, {
      signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
      next: { tags: params.tags, revalidate: params.revalidate },
    });
  } catch (err) {
    const isTimeout =
      err instanceof DOMException && err.name === "TimeoutError";
    throw new ApiFetchError(
      isTimeout
        ? `API timeout after ${FEED_TIMEOUT_MS}ms — ${url}`
        : `API network error — ${url}: ${(err as Error).message}`,
      isTimeout ? "timeout" : "network",
    );
  }

  if (!res.ok) {
    throw new ApiFetchError(
      `API error: ${res.status} ${res.statusText} — ${url}`,
      "http",
      res.status,
    );
  }

  const json = await res.json();
  const payload: SitemapFeedPayload<T> =
    json && Object.prototype.hasOwnProperty.call(json, "data")
      ? json.data
      : json;
  return Array.isArray(payload?.items) ? payload.items : [];
}

/**
 * Active products with a slug + `updated_at`, newest-edited first (the feed
 * orders by `updated_at DESC NULLS LAST` on purpose — Google re-crawls the
 * head of a sitemap first, so the rows that changed lead).
 *
 * `limit` is the caller's sitemap ceiling, passed straight through as
 * `page_size`. We deliberately do NOT page past it: a catalogue big enough to
 * need a second request is also big enough to need a sitemap INDEX
 * (`generateSitemaps()`), which changes the emitted URL shape and the pointer
 * `robots.ts` publishes — so silently paging here would hide the real problem.
 */
export const fetchSitemapProducts = cache(
  async (storeId: string, limit: number): Promise<SitemapProductEntry[]> =>
    fetchFeed<SitemapProductEntry>(storeId, "products", {
      pageSize: limit,
      tags: [`sitemap:products:${storeId}`, `products:${storeId}`],
      revalidate: 60,
    }),
);

/**
 * Active collections with a slug + `updated_at`.
 *
 * No size argument: the categories branch ignores `page`/`page_size` and
 * returns `ListCategoriesUseCase`'s default first 100 — byte-for-byte the same
 * call `/categories` makes, so the set matches what the sitemap emitted before.
 * A store with more than 100 collections needs the BACKEND to page; pretending
 * to here would just move the truncation somewhere harder to find.
 */
export const fetchSitemapCollections = cache(
  async (storeId: string): Promise<SitemapCollectionEntry[]> =>
    fetchFeed<SitemapCollectionEntry>(storeId, "categories", {
      tags: [`sitemap:categories:${storeId}`, `categories:${storeId}`],
      revalidate: 120,
    }),
);
