/**
 * Server-side API client for the NUMU storefront.
 *
 * Uses Next.js fetch with cache tags and ISR revalidation.
 * All paths must match the FastAPI backend route structure:
 *   - Store lookup:  GET /storefront/store-by-subdomain/{subdomain}
 *   - Theme resolve: GET /storefront/theme/{store_id}
 *   - Products:      GET /storefront/store/{store_id}/products
 *   - Collections:   GET /storefront/store/{store_id}/categories
 */

const API_URL = process.env.NUMU_API_URL || "http://localhost:8000/api/v1";

interface FetchOptions extends RequestInit {
  tags?: string[];
  revalidate?: number;
}

async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { tags, revalidate, ...fetchOptions } = options;
  const url = `${API_URL}${path}`;

  const res = await fetch(url, {
    ...fetchOptions,
    next: {
      tags: tags || [],
      revalidate: revalidate ?? 60,
    },
  });

  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText} — ${url}`);
  }

  const json = await res.json();
  // Backend wraps responses in { data, message, ... }
  return json.data !== undefined ? json.data : json;
}

// ── Store Lookup ──────────────────────────────────────────────────────────────

/**
 * Resolve a store by its subdomain (e.g., "mystore" from mystore.numu.io).
 * Backend: GET /storefront/store-by-subdomain/{subdomain}
 */
export async function fetchStoreByDomain(domain: string) {
  // The domain may be "mystore.numu.io" or just "mystore"
  const subdomain = domain.includes(".") ? domain.split(".")[0] : domain;
  return apiFetch<any>(`/storefront/store-by-subdomain/${encodeURIComponent(subdomain)}`, {
    tags: [`store-${subdomain}`],
    revalidate: 300,
  });
}

// ── Theme Resolution ──────────────────────────────────────────────────────────

/**
 * Resolve the active theme + customization for a store (SSR).
 * Backend: GET /storefront/theme/{store_id}
 */
export async function fetchThemeSettings(storeId: string) {
  return apiFetch<any>(`/storefront/theme/${storeId}`, {
    tags: [`theme-${storeId}`],
    revalidate: 60,
  });
}

/**
 * Fetch draft theme settings for preview mode.
 * Backend: GET /storefront/theme/{store_id}?draft=true&installation_id={id}
 */
export async function fetchDraftThemeSettings(storeId: string, installationId: string) {
  return apiFetch<any>(
    `/storefront/theme/${storeId}?draft=true&installation_id=${installationId}`,
    {
      tags: [`theme-draft-${storeId}`],
      revalidate: 0, // Never cache drafts
    },
  );
}

// ── Products ──────────────────────────────────────────────────────────────────

/**
 * Fetch products for a store's public catalog.
 * Backend: GET /storefront/store/{store_id}/products
 */
export async function fetchProducts(storeId: string, limit = 20) {
  return apiFetch<any>(`/storefront/store/${storeId}/products?limit=${limit}`, {
    tags: [`products-${storeId}`],
    revalidate: 60,
  });
}

/**
 * Fetch a single product by slug.
 * Backend: GET /storefront/store/{store_id}/products (filtered by slug)
 */
export async function fetchProductBySlug(storeId: string, slug: string) {
  return apiFetch<any>(`/storefront/store/${storeId}/products?slug=${slug}`, {
    tags: [`product-${storeId}-${slug}`],
    revalidate: 60,
  });
}

// ── Collections / Categories ──────────────────────────────────────────────────

/**
 * Fetch categories (collections) for a store.
 * Backend: GET /storefront/store/{store_id}/categories
 */
export async function fetchCollections(storeId: string) {
  return apiFetch<any>(`/storefront/store/${storeId}/categories`, {
    tags: [`collections-${storeId}`],
    revalidate: 120,
  });
}

/**
 * Fetch a single collection by slug.
 */
export async function fetchCollectionBySlug(storeId: string, slug: string) {
  return apiFetch<any>(`/storefront/store/${storeId}/categories?slug=${slug}`, {
    tags: [`collection-${storeId}-${slug}`],
    revalidate: 60,
  });
}
