/**
 * Storefront blog fetchers.
 *
 * Backed by the real backend endpoints (published-only):
 *   GET /storefront/store/{store_id}/blogs
 *   GET /storefront/store/{store_id}/blogs/{handle}
 *   GET /storefront/store/{store_id}/blogs/{handle}/articles
 *   GET /storefront/store/{store_id}/blogs/{blog}/articles/{handle}
 *
 * Text fields are bilingual dicts ({en, ar}) like the pages endpoints —
 * pick the visitor's language with `pickText`. Fetchers still return
 * null/[] gracefully on any failure so theme menus never 404 a store.
 *
 * Cache: tagged `blogs-{storeId}` — the backend busts it on every
 * blog/article change and on scheduled publishes
 * (revalidate_on_blog_change), with the 300s ISR window as the net.
 *
 * A renamed article's OLD handle still resolves: the payload's `handle`
 * is the CURRENT one, and the article route 301s to the canonical URL.
 */

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

/** Bilingual text map ({en, ar}) as stored by the merchant hub. */
export type LocalizedText = Record<string, string>;

export interface BlogSummary {
  handle: string;
  title: LocalizedText;
  description?: LocalizedText | null;
}

export interface ArticleSummary {
  handle: string;
  title: LocalizedText;
  excerpt?: LocalizedText | null;
  image_url?: string | null;
  published_at?: string | null;
  author?: string | null;
  tags?: string[];
}

export interface ArticleDetail extends ArticleSummary {
  body?: LocalizedText | null;
  seo?: Record<string, unknown> | null;
  blog?: BlogSummary | null;
}

/**
 * The language THIS visitor should be served — not the store's default.
 *
 * `x-numu-locale` is stamped by the proxy (URL prefix › `?locale` › cookie)
 * and is what `layout.tsx` uses to set `<html lang/dir>`. The blog routes
 * originally read `store.default_language` directly, so an Arabic shopper got
 * `<html dir="rtl" lang="ar">` wrapped around English article copy — and an
 * English `<title>`/description in the metadata, since `generateMetadata`
 * picked the language the same way. Shared here so all three blog routes
 * resolve it identically.
 */
export async function resolveVisitorLang(store: unknown): Promise<string> {
  const { headers } = await import("next/headers");
  const hl = await headers();
  return (
    hl.get("x-numu-locale") ||
    (store as { default_language?: string } | null)?.default_language ||
    "en"
  );
}

/** Resolve a bilingual map to the visitor's language (en↔ar fallback). */
export function pickText(
  map: LocalizedText | null | undefined,
  lang: string,
): string {
  if (!map) return "";
  return (lang === "ar" ? map.ar || map.en : map.en || map.ar) || "";
}

async function safeFetch<T>(path: string, storeId: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      next: { tags: ["blogs", `blogs-${storeId}`], revalidate: 300 },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return (body?.data ?? body) as T;
  } catch {
    return null;
  }
}

export async function fetchBlogsList(storeId: string): Promise<BlogSummary[]> {
  const data = await safeFetch<BlogSummary[]>(
    `/storefront/store/${storeId}/blogs`,
    storeId,
  );
  return data || [];
}

export async function fetchBlogByHandle(
  storeId: string,
  handle: string,
): Promise<BlogSummary | null> {
  return safeFetch<BlogSummary>(
    `/storefront/store/${storeId}/blogs/${encodeURIComponent(handle)}`,
    storeId,
  );
}

export async function fetchArticlesList(
  storeId: string,
  blogHandle: string,
): Promise<ArticleSummary[]> {
  const data = await safeFetch<ArticleSummary[]>(
    `/storefront/store/${storeId}/blogs/${encodeURIComponent(blogHandle)}/articles`,
    storeId,
  );
  return data || [];
}

export async function fetchArticleByHandle(
  storeId: string,
  blogHandle: string,
  articleHandle: string,
): Promise<ArticleDetail | null> {
  return safeFetch<ArticleDetail>(
    `/storefront/store/${storeId}/blogs/${encodeURIComponent(blogHandle)}/articles/${encodeURIComponent(articleHandle)}`,
    storeId,
  );
}
