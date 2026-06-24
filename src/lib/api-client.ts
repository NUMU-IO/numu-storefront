import { cache } from "react";
import { headers } from "next/headers";
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
/**
 * Reconcile the API's store payload with the app's StoreData shape.
 *
 * The backend exposes the capture currency as `default_currency` (a
 * Currency enum value), but the rest of the storefront reads
 * `store.currency`. Without this mapping `store.currency` was always
 * undefined and every price silently fell back to "EGP" — wrong for a
 * Saudi (SAR) store. Also surfaces `country` for locale selection.
 */
function normalizeStore(raw: StoreData & { default_currency?: string }): StoreData {
  return {
    ...raw,
    currency: raw?.default_currency ?? raw?.currency ?? "EGP",
    country: raw?.country ?? "EG",
  };
}

export const fetchStoreByHost = cache(async (rawHost: string) => {
  // Compare host vs platform domain with the port stripped from BOTH. The
  // proxy stamps `x-numu-host` without a port (e.g. `testlocal.localhost`)
  // while NUMU_PLATFORM_DOMAIN in dev carries one (`localhost:3100`); a raw
  // `.endsWith` then fails and a valid subdomain store is misrouted to the
  // custom-domain lookup → 404 (this is why the themed 404 fell back to the
  // generic one on localhost). Port-insensitive matching fixes dev and is a
  // no-op in prod (subdomain.numueg.app vs numueg.app, no ports).
  const host = rawHost.toLowerCase().split(":")[0];
  const platformDomain = (process.env.NUMU_PLATFORM_DOMAIN || "numueg.app")
    .toLowerCase()
    .split(":")[0];
  const isSubdomain =
    host.endsWith(`.${platformDomain}`) && host !== platformDomain;
  if (isSubdomain) {
    // The store slug is always the LEFTMOST label. Parallel-env hosts carry
    // an environment infix that the page proxy (proxy.ts) strips for the
    // [domain] segment, but /api/* proxy routes read the raw host and don't:
    //   yarab-test.v3.test.numueg.app → "yarab-test.v3.test" → slug "yarab-test"
    //   yarab-test.test.numueg.app    → "yarab-test.test"    → slug "yarab-test"
    //   yarab-test.staging.numueg.app → "yarab-test.staging" → slug "yarab-test"
    //   yarab-test.numueg.app         → "yarab-test"         → slug "yarab-test"
    // Without this, store-by-subdomain got the infixed string and 404'd, so
    // every /api/* proxy (shipping, checkout, …) returned "Store not found".
    const subdomain = host
      .slice(0, -(platformDomain.length + 1))
      .split(".")[0];
    return normalizeStore(
      await apiFetch<StoreData>(
        `/storefront/store-by-subdomain/${encodeURIComponent(subdomain)}`,
        // Publish busts `store-{subdomain}` immediately (NUMU-api
        // revalidate_on_customization_publish); this 60s window is only the
        // safety-net floor for a missed bust — was 300s (a 5-min stale tail).
        { tags: [`store-${subdomain}`], revalidate: 60 },
      ),
    );
  }
  return normalizeStore(
    await apiFetch<StoreData>(
      `/storefront/store-by-domain/${encodeURIComponent(host)}`,
      { tags: [`store-${host}`], revalidate: 60 },
    ),
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
    return normalizeStore(
      await apiFetch<StoreData>(
        `/storefront/store-by-subdomain/${encodeURIComponent(domainOrSubdomain)}`,
        { tags: [`store-${domainOrSubdomain}`], revalidate: 60 },
      ),
    );
  }
  // Otherwise it's a full hostname (possibly a subdomain we left intact,
  // or a custom domain). Try subdomain extraction first; fall through to
  // custom-domain lookup if the hostname doesn't end in PLATFORM_DOMAIN.
  return fetchStoreByHost(domainOrSubdomain);
});

// ── Theme Resolution ──────────────────────────────────────────────────────────

// ── Marketplace preview override ──────────────────────────────────────────
//
// Session E (2026-05-28). When the request arrived through the
// `?preview_theme_slug=<slug>` channel (proxy.ts forwards it as an
// `x-numu-preview-slug` header), we override the active theme with the
// marketplace theme's latest published bundle. This is the "Try theme"
// flow from file 06 §5.
//
// Read-only by construction:
//   - We never POST to /stores/{id}/marketplace/install or activate.
//   - We never write to store_themes, store_theme_snapshots, or
//     marketplace_theme_installations.
//   - The preview fetch uses `cache: "no-store"` so it can't bleed
//     into another visitor's ISR-cached response.
//
// Graceful fallback: if the preview slug doesn't resolve (theme
// unpublished / no version yet), we log a warning and fall through to
// the active store theme. The merchant sees the iframe still load
// against their live theme rather than a crash.
//
// Cache wrapper: the React `cache(...)` deduper is per-request, so the
// layout and each page that calls fetchThemeSettings within one render
// pass share the same preview result. Different requests get different
// caches so preview state never leaks across visitors.

interface PreviewThemeMetadata {
  bundle_url: string | null;
  css_url: string | null;
  section_schemas: unknown;
  settings_schema: unknown;
  presets: unknown;
}

interface PreviewThemeDetail {
  id: string;
  slug: string;
  name: string;
  latest_version: PreviewThemeMetadata | null;
}

async function readPreviewSlug(): Promise<string | null> {
  try {
    const h = await headers();
    const slug = h.get("x-numu-preview-slug");
    return slug && slug.trim() ? slug.trim() : null;
  } catch {
    // headers() throws when called outside a request scope (e.g. tests).
    // Falling through to the normal fetch is the safe default.
    return null;
  }
}

async function buildPreviewThemePayload(
  storeId: string,
  slug: string,
): Promise<Record<string, unknown> | null> {
  try {
    // Direct fetch (no React Query): the preview endpoint is anonymous
    // and we explicitly opt out of caching so each preview hit re-reads
    // the marketplace metadata. Server logs the fall-through so a
    // future debugging session can correlate "preview rendered with
    // active theme" with the slug that didn't resolve.
    const res = await fetch(
      `${API_URL}/marketplace/catalog/themes/${encodeURIComponent(slug)}`,
      { cache: "no-store" },
    );
    if (!res.ok) {
      console.warn(
        `[preview] could not load marketplace theme '${slug}' for preview (HTTP ${res.status}); falling back to active theme.`,
      );
      return null;
    }
    const wrapped = await res.json();
    const detail = (wrapped && "data" in wrapped ? wrapped.data : wrapped) as
      | PreviewThemeDetail
      | null;
    const bundle = detail?.latest_version?.bundle_url ?? null;
    if (!detail || !bundle) {
      console.warn(
        `[preview] marketplace theme '${slug}' has no published bundle; falling back to active theme.`,
      );
      return null;
    }

    // Synthesise a minimal `themeRaw`-shaped payload. resolveThemeSettings
    // looks for either `theme_settings` (nested V3) or a top-level
    // `external_theme`. We provide both so the layout's `isByot`
    // detection (which reads from the resolved settings) lights up
    // regardless of which branch resolveThemeSettings takes.
    const externalTheme = {
      bundle_url: bundle,
      css_url: detail.latest_version!.css_url,
      mode: "preview",
      settings_schema: detail.latest_version!.settings_schema,
      section_schemas: detail.latest_version!.section_schemas,
      presets: detail.latest_version!.presets,
      theme_id: detail.slug,
    };

    return {
      // Top-level `external_theme` for the V1/V2 normalisation branch
      // in resolve-theme.ts (lines 131-133).
      external_theme: externalTheme,
      // Nested V3 customization so the layout sees the preview as a
      // fully-formed V3 store. Empty templates + section_groups let the
      // bundle's own built-in presets take over via main.tsx's
      // BUILTIN_TEMPLATES fallback.
      theme_settings: {
        schema_version: 3,
        theme_id: detail.slug,
        global_settings: {},
        templates: {},
        section_groups: {},
        external_theme: externalTheme,
      },
      // Marker so future consumers (a "Previewing" banner inside the
      // storefront, for instance) can branch. Nothing reads this yet.
      _is_preview: true,
      _preview_theme_slug: slug,
      _preview_store_id: storeId,
    };
  } catch (err) {
    console.warn(
      `[preview] error loading marketplace theme '${slug}' for preview: ${(err as Error).message}; falling back to active theme.`,
    );
    return null;
  }
}

export const fetchThemeSettings = cache(async (storeId: string) => {
  // Preview override comes first — when the proxy forwarded a slug we
  // try to substitute the marketplace bundle's metadata. Any failure
  // here logs + falls through to the merchant's real active theme.
  const previewSlug = await readPreviewSlug();
  if (previewSlug) {
    const previewPayload = await buildPreviewThemePayload(storeId, previewSlug);
    if (previewPayload) return previewPayload;
    // else: fall through silently — the storefront renders the active
    // theme. ThemePreviewPage surfaces a "no published version" banner
    // independently using the same getThemeDetail call.
  }

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
  const basePrice = Number.isFinite(price) ? price : 0;
  const compareAt = raw.compare_at_price != null ? Number(raw.compare_at_price) : undefined;
  // The API returns `images` as a plain string[] of URLs, but the SDK
  // contract (ProductImage[]) — and every theme — reads `images[i].url`.
  // Coerce string entries into { id, url } objects so themes render images;
  // pass through entries that are already objects.
  const images = Array.isArray(raw.images)
    ? raw.images.map((img: unknown, i: number) =>
        typeof img === "string" ? { id: String(i), url: img } : img,
      )
    : [];
  // ── Variant price normalization (supersedes the earlier ENG-1 fix) ──────
  // The API serializes the PRODUCT price in MAJOR units ("110.00") but
  // VARIANT prices in CENTS ("11000.00") — an inconsistency. Themes prefer
  // `variant.price ?? product.price`, so without this they render variant
  // prices ×100. Converting variant money cents→major makes prices major
  // end-to-end AND reconciles the no-option case (a single product's implicit
  // variant came back as 3000.00 cents → 30.00 == base, so listing and PDP
  // agree) — i.e. this also covers what ENG-1's reconcile-to-base did, without
  // double-transforming. NOTE: bandaid for a backend serialization bug — if
  // variant prices start arriving as major, drop this.
  const variants = Array.isArray(raw.variants)
    ? raw.variants.map((v: Record<string, any>) => {
        if (!v || typeof v !== "object") return v;
        const out: Record<string, any> = { ...v };
        if (v.price != null) out.price = Number(v.price) / 100;
        if (v.compare_at_price != null)
          out.compare_at_price = Number(v.compare_at_price) / 100;
        return out;
      })
    : raw.variants;
  return {
    ...raw,
    price: Number.isFinite(price) ? price : 0,
    ...(compareAt !== undefined && Number.isFinite(compareAt)
      ? { compare_at_price: compareAt }
      : {}),
    images,
    currency: raw.currency ?? raw.price_currency ?? "USD",
    in_stock: raw.in_stock ?? raw.is_in_stock ?? false,
    ...(variants !== undefined ? { variants } : {}),
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
    // Hit the single-product endpoint (not the list endpoint with
    // ?slug=) — the list endpoint omits `variants[]` and `options[]`,
    // which the PDP needs for the variant picker after Phase 8.1.
    // The single endpoint wraps the result in `{ data: {...} }`.
    const wrapped = await apiFetch<Record<string, any>>(
      `/storefront/store/${storeId}/products/${encodeURIComponent(slug)}`,
      { tags: [`product:${storeId}:${slug}`], revalidate: 60 },
    );
    let raw: Record<string, any> | null;
    if (wrapped && typeof wrapped === "object" && "data" in wrapped) {
      raw = (wrapped as { data?: Record<string, any> }).data ?? null;
    } else if (wrapped && Array.isArray(wrapped.items)) {
      // Tolerate the old shape during rollout — if a deployment still
      // returns the paginated wrapper, fall back to its first item.
      raw = wrapped.items[0] ?? null;
    } else if (Array.isArray(wrapped)) {
      raw = wrapped[0] ?? null;
    } else {
      raw = wrapped ?? null;
    }
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

// ── Navigation menus (Phase 2.4) ────────────────────────────────────────────

/**
 * Fetch the store's navigation menus (header/footer link lists) and key
 * them by handle for injection into the BYOT mount context.
 *
 * ISR-tagged `menus-${storeId}` — the exact tag the backend posts to
 * `/api/revalidate` from `revalidate_on_menu_change` when a merchant
 * saves a menu in the Navigation manager, so affected pages regenerate.
 *
 * Returns a `{ [handle]: items[] }` map. Items keep the raw bilingual
 * shape (`{id, label:{en,ar}, url, type, resource_id, children}`); the
 * SDK's `useNavigation` localizes them per the visitor's active locale.
 * Any failure resolves to `{}` so the bundle falls back to DEFAULT_NAV.
 */
export const fetchStoreMenus = cache(
  async (storeId: string): Promise<Record<string, any[]>> => {
    const wrapped = await apiFetch<any>(`/storefront/store/${storeId}/menus`, {
      tags: [`menus-${storeId}`],
      revalidate: 120,
    });
    const list: any[] = Array.isArray(wrapped)
      ? wrapped
      : wrapped && Array.isArray(wrapped.items)
        ? wrapped.items
        : [];
    const map: Record<string, any[]> = {};
    for (const menu of list) {
      if (menu && typeof menu.handle === "string") {
        map[menu.handle] = Array.isArray(menu.items) ? menu.items : [];
      }
    }
    return map;
  },
);

// ── Content pages (Phase 4.4b) ──────────────────────────────────────────────

export interface StorefrontPage {
  id: string;
  handle: string;
  title: Record<string, string>;
  body: Record<string, string>;
  seo: Record<string, unknown>;
  template: string;
}

/**
 * Fetch a single PUBLISHED content page by handle for `/pages/<handle>`.
 * ISR-tagged `pages-{storeId}` so a publish/edit busts it. Resolves to
 * `null` when the page doesn't exist or isn't published — the route then
 * falls back to a humanized placeholder (BYOT links never hard-404).
 */
export const fetchStorePage = cache(
  async (storeId: string, handle: string): Promise<StorefrontPage | null> => {
    try {
      return await apiFetch<StorefrontPage>(
        `/storefront/store/${storeId}/pages/${encodeURIComponent(handle)}`,
        { tags: [`pages-${storeId}`], revalidate: 120 },
      );
    } catch {
      return null;
    }
  },
);
