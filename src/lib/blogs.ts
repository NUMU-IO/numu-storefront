/**
 * Storefront blog fetchers — Phase 1.8.
 *
 * Each fetcher calls the backend's storefront blog endpoints and
 * returns null/[] gracefully when the endpoint isn't deployed yet.
 * This is the v1 stub: routes exist, theme menus don't 404, and the
 * day the backend adds the tables this layer wires up automatically.
 *
 * Backend contract (when shipped):
 *   GET /storefront/store/{store_id}/blogs
 *     → SuccessResponse<list[BlogSummary]>
 *   GET /storefront/store/{store_id}/blogs/{handle}
 *     → SuccessResponse<BlogSummary>
 *   GET /storefront/store/{store_id}/blogs/{handle}/articles
 *     → SuccessResponse<list[ArticleSummary]>
 *   GET /storefront/store/{store_id}/blogs/{blog}/articles/{handle}
 *     → SuccessResponse<ArticleDetail>
 */

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

export interface BlogSummary {
  handle: string;
  title: string;
  description?: string | null;
}

export interface ArticleSummary {
  handle: string;
  title: string;
  excerpt?: string | null;
  published_at?: string | null;
  author?: string | null;
}

export interface ArticleDetail extends ArticleSummary {
  body_html?: string | null;
}

async function safeFetch<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${API_URL}${path}`, {
      next: { tags: ["blogs"], revalidate: 300 },
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
  );
  return data || [];
}

export async function fetchBlogByHandle(
  storeId: string,
  handle: string,
): Promise<BlogSummary | null> {
  return safeFetch<BlogSummary>(
    `/storefront/store/${storeId}/blogs/${encodeURIComponent(handle)}`,
  );
}

export async function fetchArticlesList(
  storeId: string,
  blogHandle: string,
): Promise<ArticleSummary[]> {
  const data = await safeFetch<ArticleSummary[]>(
    `/storefront/store/${storeId}/blogs/${encodeURIComponent(blogHandle)}/articles`,
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
  );
}
