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

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

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
  // If the inbound segment lacks a dot, the proxy already stripped
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

// ── Customer (server-side resolution from cookie) ─────────────────────────────

/**
 * Resolve the currently-logged-in customer from the request's
 * `customer_access_token` cookie. Used by the [domain]/account/*
 * routes to fork on auth state at SSR time (so an unauthenticated
 * visitor lands on /account/login synchronously without a client-side
 * round-trip).
 *
 * Returns null on any failure (no cookie, expired token, missing
 * customer record). The route decides what to do — typically redirect
 * to /account/login for protected pages, or render the unauth layout
 * for the auth pages themselves.
 *
 * NOT cached — auth state mustn't leak across visitors.
 */
export async function fetchCurrentCustomer(
  cookieHeader: string | null | undefined,
): Promise<Record<string, any> | null> {
  if (!cookieHeader || !cookieHeader.includes("customer_access_token")) {
    return null;
  }
  try {
    const res = await fetch(`${API_URL}/storefront/me/profile`, {
      method: "GET",
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.data as Record<string, any>) ?? null;
  } catch {
    return null;
  }
}

/**
 * Server-side fetch of the logged-in customer's orders. Used by
 * `/account/orders/page.tsx` to pre-populate page.data.orders for
 * BYOT themes.
 */
export async function fetchCustomerOrders(
  cookieHeader: string | null | undefined,
): Promise<any[]> {
  if (!cookieHeader) return [];
  try {
    const res = await fetch(`${API_URL}/storefront/me/orders`, {
      method: "GET",
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = await res.json();
    const data = json?.data;
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    return [];
  } catch {
    return [];
  }
}

export async function fetchCustomerOrder(
  cookieHeader: string | null | undefined,
  orderId: string,
): Promise<Record<string, any> | null> {
  if (!cookieHeader) return null;
  try {
    const res = await fetch(
      `${API_URL}/storefront/me/orders/${encodeURIComponent(orderId)}`,
      { method: "GET", headers: { cookie: cookieHeader }, cache: "no-store" },
    );
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.data as Record<string, any>) ?? null;
  } catch {
    return null;
  }
}

export async function fetchCustomerAddresses(
  cookieHeader: string | null | undefined,
): Promise<any[]> {
  if (!cookieHeader) return [];
  try {
    const res = await fetch(`${API_URL}/storefront/me/addresses`, {
      method: "GET",
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = await res.json();
    const data = json?.data;
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    return [];
  } catch {
    return [];
  }
}

// ── Products ──────────────────────────────────────────────────────────────────

/**
 * Normalize a backend product row into the SDK's Product type.
 *
 * The API returns Decimal-as-string prices (`"120.00"`), `price_currency`
 * instead of `currency`, and `is_in_stock` instead of `in_stock`. The
 * theme SDK and theme bundles consume the cleaner SDK shape, so we
 * adapt at this single boundary instead of forcing every theme to
 * remember the API's quirks.
 */
function normalizeProduct(raw: Record<string, any> | null | undefined): any {
  if (!raw) return raw;
  const price = Number(raw.price ?? 0);
  const compareAt = raw.compare_at_price != null ? Number(raw.compare_at_price) : undefined;
  return {
    ...raw,
    price: Number.isFinite(price) ? price : 0,
    ...(compareAt !== undefined && Number.isFinite(compareAt)
      ? { compare_at_price: compareAt }
      : {}),
    currency: raw.currency ?? raw.price_currency ?? "USD",
    in_stock: raw.in_stock ?? raw.is_in_stock ?? false,
  };
}

export const fetchProducts = cache(async (storeId: string, limit = 20) => {
  // The backend returns the paginated wrapper `{items, total, page, ...}`.
  // Theme bundles (and the route handlers that pass this to `page.data.products`)
  // expect a plain array. Unwrap here so callers don't have to remember
  // — every consumer wants the array shape and treating the wrapper as
  // an array silently drops all products to the demo fallback.
  const wrapped = await apiFetch<Record<string, any>>(
    `/storefront/store/${storeId}/products?limit=${limit}`,
    { tags: [`products:${storeId}`], revalidate: 60 },
  );
  const items: any[] = Array.isArray(wrapped)
    ? wrapped
    : wrapped && Array.isArray(wrapped.items)
      ? wrapped.items
      : [];
  return items.map(normalizeProduct);
});

export const fetchProductBySlug = cache(
  async (storeId: string, slug: string) => {
    const wrapped = await apiFetch<Record<string, any>>(
      `/storefront/store/${storeId}/products?slug=${encodeURIComponent(slug)}`,
      { tags: [`product:${storeId}:${slug}`], revalidate: 60 },
    );
    // The list endpoint always returns the paginated wrapper, even for
    // single-slug lookups. Pull out the first item so the product
    // detail page route gets a flat (normalized) product object.
    let raw: Record<string, any> | null;
    if (wrapped && Array.isArray(wrapped.items)) raw = wrapped.items[0] ?? null;
    else if (Array.isArray(wrapped)) raw = wrapped[0] ?? null;
    else raw = wrapped ?? null;
    return normalizeProduct(raw);
  },
);

// ── Collections / Categories ──────────────────────────────────────────────────

export const fetchCollections = cache(async (storeId: string) => {
  // Categories endpoint returns either a plain array or a paginated
  // wrapper depending on the deployment version. Normalize to array.
  const wrapped = await apiFetch<Record<string, any>>(
    `/storefront/store/${storeId}/categories`,
    {
      tags: [`categories:${storeId}`],
      revalidate: 120,
    },
  );
  if (Array.isArray(wrapped)) return wrapped;
  if (wrapped && Array.isArray(wrapped.items)) return wrapped.items;
  return [];
});

export const fetchCollectionBySlug = cache(
  async (storeId: string, slug: string) => {
    return apiFetch<Record<string, any>>(
      `/storefront/store/${storeId}/categories?slug=${encodeURIComponent(slug)}`,
      { tags: [`category:${storeId}:${slug}`], revalidate: 60 },
    );
  },
);
