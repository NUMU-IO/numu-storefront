import { cache } from "react";
import type { StoreData } from "@/types";

/**
 * Server-side API client for the NUMU storefront.
 *
 * Uses Next.js fetch with cache tags + ISR revalidation. The fetchers are
 * wrapped in `React.cache()` so the same render dedupes calls across the
 * `[domain]/layout.tsx` and `[domain]/page.tsx` boundaries — without this,
 * each component re-runs its own fetch even when the URL is identical.
 *
 * Backend route map:
 *   GET /storefront/store-by-subdomain/{subdomain}  — subdomain lookup
 *   GET /storefront/store-by-domain/{domain}        — custom domain lookup
 *   GET /storefront/theme/{store_id}                — V3-resolved theme
 *   GET /storefront/store/{store_id}/products       — public catalog
 *   GET /storefront/store/{store_id}/categories     — collections
 */

const API_URL = process.env.NUMU_API_URL || "http://localhost:8000/api/v1";

interface FetchOptions extends RequestInit {
  tags?: string[];
  revalidate?: number;
}

async function apiFetch<T>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
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
  // Backend wraps responses in { success, data, message, ... } when they
  // come from a SuccessResponse. Some legacy endpoints return the payload
  // directly. Fall back to the raw body when there is no `data` key.
  return json && Object.prototype.hasOwnProperty.call(json, "data")
    ? (json.data as T)
    : (json as T);
}

// ── Store Lookup ──────────────────────────────────────────────────────────────

/**
 * Resolve a store given an inbound hostname. Distinguishes subdomain stores
 * from custom-domain stores: anything that ends in `.${PLATFORM_DOMAIN}` is
 * a subdomain (the prefix is the slug); everything else is treated as a
 * custom domain and looked up by full hostname.
 */
export const fetchStoreByHost = cache(async (rawHost: string) => {
  const host = rawHost.toLowerCase();
  const platformDomain = process.env.NUMU_PLATFORM_DOMAIN || "numueg.app";
  const isSubdomain =
    host.endsWith(`.${platformDomain}`) && host !== platformDomain;
  if (isSubdomain) {
    const subdomain = host.slice(0, -(platformDomain.length + 1));
    return apiFetch<StoreData>(
      `/storefront/store-by-subdomain/${encodeURIComponent(subdomain)}`,
      { tags: [`store-${subdomain}`], revalidate: 300 },
    );
  }
  return apiFetch<StoreData>(
    `/storefront/store-by-domain/${encodeURIComponent(host)}`,
    { tags: [`store-${host}`], revalidate: 300 },
  );
});

/**
 * Backwards-compatible name. The middleware passes the full hostname (or
 * its subdomain prefix) under the dynamic [domain] route segment, so this
 * just delegates to fetchStoreByHost.
 */
export const fetchStoreByDomain = cache(async (domainOrSubdomain: string) => {
  // If the inbound segment lacks a dot, the middleware already stripped
  // the platform domain; treat it as a subdomain.
  const platformDomain = process.env.NUMU_PLATFORM_DOMAIN || "numueg.app";
  if (!domainOrSubdomain.includes(".")) {
    return apiFetch<StoreData>(
      `/storefront/store-by-subdomain/${encodeURIComponent(domainOrSubdomain)}`,
      { tags: [`store-${domainOrSubdomain}`], revalidate: 300 },
    );
  }
  // Otherwise it's a full hostname (possibly a subdomain we left intact,
  // or a custom domain). Try subdomain extraction first; fall through to
  // custom-domain lookup if the hostname doesn't end in PLATFORM_DOMAIN.
  return fetchStoreByHost(domainOrSubdomain);
});

// ── Theme Resolution ──────────────────────────────────────────────────────────

export const fetchThemeSettings = cache(async (storeId: string) => {
  return apiFetch<Record<string, unknown>>(
    `/storefront/theme/${storeId}`,
    { tags: [`theme-${storeId}`], revalidate: 60 },
  );
});

export const fetchDraftThemeSettings = cache(
  async (storeId: string, installationId: string) => {
    return apiFetch<Record<string, unknown>>(
      `/storefront/theme/${storeId}?draft=true&installation_id=${encodeURIComponent(installationId)}`,
      { tags: [`theme-draft-${storeId}`], revalidate: 0 },
    );
  },
);

// ── Products ──────────────────────────────────────────────────────────────────

export const fetchProducts = cache(async (storeId: string, limit = 20) => {
  return apiFetch<Record<string, any>>(
    `/storefront/store/${storeId}/products?limit=${limit}`,
    { tags: [`products:${storeId}`], revalidate: 60 },
  );
});

export const fetchProductBySlug = cache(
  async (storeId: string, slug: string) => {
    return apiFetch<Record<string, any>>(
      `/storefront/store/${storeId}/products?slug=${encodeURIComponent(slug)}`,
      { tags: [`product:${storeId}:${slug}`], revalidate: 60 },
    );
  },
);

// ── Collections / Categories ──────────────────────────────────────────────────

export const fetchCollections = cache(async (storeId: string) => {
  return apiFetch<Record<string, any>>(`/storefront/store/${storeId}/categories`, {
    tags: [`categories:${storeId}`],
    revalidate: 120,
  });
});

export const fetchCollectionBySlug = cache(
  async (storeId: string, slug: string) => {
    return apiFetch<Record<string, any>>(
      `/storefront/store/${storeId}/categories?slug=${encodeURIComponent(slug)}`,
      { tags: [`category:${storeId}:${slug}`], revalidate: 60 },
    );
  },
);
