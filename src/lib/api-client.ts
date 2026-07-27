import { cache } from "react";
import { headers } from "next/headers";
import { isArabicLocale } from "@/lib/seo";
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

/**
 * Default per-request timeout (ms) for backend calls. A read that hasn't
 * returned in 5s is almost always a hung/unreachable upstream, not a
 * slow-but-healthy one — failing fast frees the render (and the serverless
 * worker) instead of blocking on it. Overridable per call via `timeoutMs`.
 */
const DEFAULT_TIMEOUT_MS = 5_000;

/**
 * Distinguishable API-fetch failure. `kind` lets callers tell a request that
 * never produced an HTTP response ("timeout"/"network" — an upstream
 * availability problem, retry/503-worthy) apart from a real backend HTTP
 * status ("http", 4xx/5xx). `status` is set only for `kind === "http"`.
 *
 * Backward-compatible: it subclasses Error, so existing callers that just
 * `catch` and fall back keep working; the extra fields are opt-in.
 */
export class ApiFetchError extends Error {
  readonly kind: "timeout" | "network" | "http";
  readonly status?: number;
  constructor(message: string, kind: ApiFetchError["kind"], status?: number) {
    super(message);
    this.name = "ApiFetchError";
    this.kind = kind;
    this.status = status;
  }
}

/**
 * Build the AbortSignal for a fetch: a fresh timeout signal, combined with
 * the caller's own signal when one was passed (so EITHER firing aborts the
 * request). `AbortSignal.timeout`/`AbortSignal.any` are both available on our
 * floor (Node 20 runner / modern browsers); if `any` is somehow absent we
 * prefer the caller's signal, else the timeout.
 */
function buildFetchSignal(
  timeoutMs: number,
  caller?: AbortSignal | null,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!caller) return timeout;
  return typeof AbortSignal.any === "function"
    ? AbortSignal.any([caller, timeout])
    : caller;
}

interface FetchOptions extends RequestInit {
  tags?: string[];
  revalidate?: number;
  /** Per-call timeout override (ms). Defaults to DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
}

async function apiFetch<T>(
  path: string,
  options: FetchOptions = {},
): Promise<T> {
  const { tags, revalidate, timeoutMs, signal, ...fetchOptions } = options;
  const url = `${API_URL}${path}`;

  let res: Response;
  try {
    res = await fetch(url, {
      ...fetchOptions,
      // Bound every backend call so a hung upstream can't stall the render
      // (or pin a serverless worker) indefinitely. Combined with the caller's
      // signal when they supplied one.
      signal: buildFetchSignal(timeoutMs ?? DEFAULT_TIMEOUT_MS, signal),
      next: {
        tags: tags || [],
        revalidate: revalidate ?? 60,
      },
    });
  } catch (err) {
    // fetch only rejects (vs. resolving to a Response) on abort/timeout or a
    // transport-level failure — never on a 4xx/5xx. Wrap so callers can
    // distinguish "upstream never answered" from a real HTTP status below.
    const isTimeout =
      err instanceof DOMException && err.name === "TimeoutError";
    throw new ApiFetchError(
      isTimeout
        ? `API timeout after ${timeoutMs ?? DEFAULT_TIMEOUT_MS}ms — ${url}`
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
  // A host is a subdomain store when it sits under EITHER the configured
  // platform domain OR the canonical apex `numueg.app`. The second case is
  // essential: the page proxy canonicalizes `x-numu-host` to the apex form
  // `<slug>.numueg.app` for /api/* calls on deep parallel-env hosts
  // (proxy.ts), but on v3.test NUMU_PLATFORM_DOMAIN is `v3.test.numueg.app`,
  // so `<slug>.numueg.app` failed the platform-only endsWith check and got
  // misrouted to the custom-domain lookup → 404 "Store not found" on every
  // /api/* proxy (shipping, checkout, …). The store slug is always the
  // LEFTMOST label, so take it directly — this also collapses any env infix
  // (`<slug>.v3.test.numueg.app` → `<slug>`).
  const CANONICAL_APEX = "numueg.app";
  const underPlatform =
    host.endsWith(`.${platformDomain}`) && host !== platformDomain;
  const underApex =
    host.endsWith(`.${CANONICAL_APEX}`) && host !== CANONICAL_APEX;
  if (underPlatform || underApex) {
    const subdomain = host.split(".")[0];
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
      { cache: "no-store", signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) },
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
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
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
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
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
      {
        method: "GET",
        headers: { cookie: cookieHeader },
        cache: "no-store",
        signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
      },
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
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
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
 * The visitor's locale for THIS request, from the `x-numu-locale` header the
 * proxy stamps (URL prefix › `?locale=` › `numu_locale` cookie). Empty string
 * when there is no signal, or when we're outside a request scope.
 *
 * Read by the FETCHERS and passed into `normalizeProduct` as an argument — see
 * the Arabic-copy block there for why it must never be read inside the
 * normalizer itself.
 */
async function readRequestLocale(): Promise<string> {
  try {
    const h = await headers();
    return (h.get("x-numu-locale") || "").trim().toLowerCase();
  } catch {
    // headers() throws outside a request scope (tests, build-time evaluation).
    // No locale signal → the payload stays exactly as the API sent it.
    return "";
  }
}

/** The Arabic value under `attributes`, or null when it isn't usable copy. */
function arabicAttribute(
  attributes: unknown,
  key: "nameAr" | "descriptionAr",
): string | null {
  if (!attributes || typeof attributes !== "object") return null;
  const value = (attributes as Record<string, unknown>)[key];
  if (typeof value !== "string" || !value.trim()) return null;
  return value;
}

/**
 * Normalize a backend product row into the SDK's Product type.
 *
 * The API returns Decimal-as-string prices (`"120.00"`), `price_currency`
 * instead of `currency`, and `is_in_stock` instead of `in_stock`. The
 * theme SDK and theme bundles consume the cleaner SDK shape, so we
 * adapt at this single boundary instead of forcing every theme to
 * remember the API's quirks.
 *
 * `locale` also makes this the ONE seam where Arabic product copy is applied —
 * see the substitution at the bottom of the function.
 *
 * MUST stay a pure sync function of (raw, locale): the callers cache its input,
 * not its output.
 */
function normalizeProduct(
  raw: Record<string, any> | null | undefined,
  locale?: string,
): any {
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
  // Variant prices now arrive in MAJOR units, same as the product price
  // (backend variant_repository was aligned to the cents convention, so the
  // API serializes `variant.price.amount` in major units). Coerce string→number
  // to match product price handling; NO ÷100 (the old bandaid for the backend
  // serving variant prices as cents has been removed at the source).
  const variants = Array.isArray(raw.variants)
    ? raw.variants.map((v: Record<string, any>) => {
        if (!v || typeof v !== "object") return v;
        const out: Record<string, any> = { ...v };
        if (v.price != null) out.price = Number(v.price);
        if (v.compare_at_price != null)
          out.compare_at_price = Number(v.compare_at_price);
        return out;
      })
    : raw.variants;
  // Arabic product copy.
  //
  // `attributes.nameAr` / `attributes.descriptionAr` are the only place the
  // platform can hold per-product Arabic text (the Product model has no i18n
  // columns, `Product.name` is a plain string) — and NOTHING read them, so an
  // Arabic shopper on an otherwise fully-Arabic page still saw English product
  // names, and so did Google on `/ar/...`. Substituting HERE means all 16 themes,
  // the crawler-facing SSR content layer and the JSON-LD get Arabic with no theme
  // rebuild: every product the storefront renders passes through this function.
  //
  // ⚠️ `locale` is an ARGUMENT, never read from headers() inside this function.
  // `apiFetch` writes into Next's DATA cache, which is SHARED ACROSS REQUESTS, so
  // a locale-dependent cached payload would keep serving Arabic names to English
  // visitors (and vice versa) for the rest of the ISR window. The raw fetch stays
  // locale-agnostic; the substitution happens only in this per-request transform.
  // (The `cache()` wrapper around each fetcher is per-request and would be safe
  // either way — the data cache underneath it is not, and that is the distinction
  // the next reader will otherwise assume away.)
  //
  // Only a non-empty Arabic string substitutes. In production today `attributes`
  // carries no `nameAr` at all on most rows, and where the importer did write one
  // it wrote the ENGLISH name — so this is currently a no-op either way, which is
  // exactly why it can ship before the content pack is corrected and imported.
  const wantsArabic = isArabicLocale(locale);
  const nameAr = wantsArabic ? arabicAttribute(raw.attributes, "nameAr") : null;
  const descriptionAr = wantsArabic
    ? arabicAttribute(raw.attributes, "descriptionAr")
    : null;

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
    ...(nameAr ? { name: nameAr } : {}),
    ...(descriptionAr ? { description: descriptionAr } : {}),
  };
}

export const fetchProducts = cache(async (storeId: string, limit = 20, categoryId?: string) => {
  // The backend returns the paginated wrapper `{items, total, page, ...}`.
  // Theme bundles (and the route handlers that pass this to `page.data.products`)
  // expect a plain array. Unwrap here so callers don't have to remember
  // — every consumer wants the array shape and treating the wrapper as
  // an array silently drops all products to the demo fallback.
  //
  // `categoryId` (optional) scopes the list to one collection — the
  // collection route passes it so /collections/<slug> shows that
  // category's products instead of an empty grid.
  const categoryQs = categoryId
    ? `&category_id=${encodeURIComponent(categoryId)}`
    : "";
  // Resolved ONCE per fetch and handed to the per-request transform below; the
  // `apiFetch` calls themselves stay locale-agnostic so nothing locale-specific
  // ever lands in the cross-request data cache.
  const locale = await readRequestLocale();
  // The backend validates `limit` as 1..100 (anything above 422s, which the
  // callers' catch-alls would turn into an EMPTY storefront). Page through in
  // chunks of 100 until we have `limit` items or the catalog runs out.
  const PAGE_MAX = 100;
  const fetchPage = (page: number, pageLimit: number) =>
    apiFetch<Record<string, any>>(
      `/storefront/store/${storeId}/products?limit=${pageLimit}&page=${page}${categoryQs}`,
      { tags: [`products:${storeId}`], revalidate: 60 },
    );
  const first = await fetchPage(1, Math.min(limit, PAGE_MAX));
  const unwrap = (wrapped: any): any[] =>
    Array.isArray(wrapped)
      ? wrapped
      : wrapped && Array.isArray(wrapped.items)
        ? wrapped.items
        : [];
  let items = unwrap(first);
  const total: number =
    typeof (first as any)?.total === "number" ? (first as any).total : items.length;
  const want = Math.min(limit, total);
  if (items.length > 0 && items.length < want) {
    const pages = Math.ceil(want / PAGE_MAX);
    const rest = await Promise.all(
      Array.from({ length: pages - 1 }, (_, i) =>
        fetchPage(i + 2, PAGE_MAX).catch(() => null),
      ),
    );
    for (const w of rest) if (w) items = items.concat(unwrap(w));
  }
  return items.slice(0, want).map((item) => normalizeProduct(item, locale));
});

export const fetchProductBySlug = cache(
  async (storeId: string, slug: string) => {
    // Per-request locale for the Arabic-copy transform; see fetchProducts.
    const locale = await readRequestLocale();
    // Hit the single-product endpoint (not the list endpoint with
    // ?slug=) — the list endpoint omits `variants[]` and `options[]`,
    // which the PDP needs for the variant picker after Phase 8.1.
    // The single endpoint wraps the result in `{ data: {...} }`.
    const wrapped = await apiFetch<Record<string, any>>(
      `/storefront/store/${storeId}/products/${encodeURIComponent(slug)}`,
      // Two tags on purpose. The per-slug tag is what a single-product edit
      // busts; the store-wide one is what a change that affects EVERY product
      // at once busts — a metafield definition flipped public→private, say,
      // where enumerating the affected slugs server-side isn't practical.
      // Without the second tag such a change stays visible to shoppers for the
      // rest of the ISR window even though the API is already correct.
      { tags: [`product:${storeId}:${slug}`, `products:${storeId}`], revalidate: 60 },
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
    return normalizeProduct(raw, locale);
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
    // NOTE: the backend `/categories` endpoint ignores `?slug=` — it always
    // returns the full active list. So resolve the match client-side.
    // apiFetch unwraps `data` to the array (older deployments may still send
    // the paginated wrapper). Returns the single category object (with
    // id/name/description/image_url) or null so the caller can fall back.
    const wrapped = await apiFetch<Record<string, any>>(
      `/storefront/store/${storeId}/categories`,
      {
        tags: [`categories:${storeId}`, `category:${storeId}:${slug}`],
        revalidate: 60,
      },
    );
    const list: any[] = Array.isArray(wrapped)
      ? wrapped
      : wrapped && Array.isArray(wrapped.items)
        ? wrapped.items
        : [];
    const current = list.find((c) => c?.slug === slug);
    if (current) return current;
    // Renamed collection: match the requested slug against each category's
    // rename history (`previous_slugs`) so an indexed URL still resolves. The
    // returned object carries the CURRENT slug, which is what makes the route
    // 301 to the canonical URL instead of 404ing the accumulated ranking away.
    // Current slugs are matched FIRST above: a slug that some other collection
    // has since been renamed away from must resolve to whoever owns it now.
    return (
      list.find(
        (c) =>
          Array.isArray(c?.previous_slugs) && c.previous_slugs.includes(slug),
      ) ?? null
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
    await addBlogLinkIfUnlinked(storeId, map);
    return map;
  },
);

/**
 * Put a "Blog" entry in the main menu once a store actually has a blog.
 *
 * The blog routes shipped working but unreachable: nothing linked to `/blogs`,
 * so a merchant had to know the page existed AND go add a menu item by hand in
 * Hub → Online Store → Navigation before a single shopper could find it. A CMS
 * nobody can navigate to is a CMS nobody reads.
 *
 * Conservative on purpose:
 *   - only when the store has at least one PUBLISHED blog, so stores that
 *     never touch the feature see no change;
 *   - only when no existing item already points at /blogs — a merchant who
 *     placed their own link (anywhere, under any label) keeps full control of
 *     the position and wording;
 *   - appended last, so it never displaces the merchant's ordering;
 *   - best-effort: a blogs-fetch failure leaves the menu exactly as it was.
 */
async function addBlogLinkIfUnlinked(
  storeId: string,
  map: Record<string, any[]>,
): Promise<void> {
  try {
    const { fetchBlogsList } = await import("./blogs");
    const blogs = await fetchBlogsList(storeId);
    if (!Array.isArray(blogs) || blogs.length === 0) return;

    const linksToBlogs = (items: any[]): boolean =>
      items.some((item) => {
        const url = typeof item?.url === "string" ? item.url : "";
        if (/(^|\/)blogs(\/|$|\?)/i.test(url)) return true;
        return Array.isArray(item?.children) && linksToBlogs(item.children);
      });

    // Whichever menu the theme reads for its primary nav. `main-menu` is the
    // handle every theme defaults to; fall back to the only menu present.
    const handles = Object.keys(map);
    const target =
      handles.find((h) => h === "main-menu") ??
      (handles.length === 1 ? handles[0] : undefined);
    if (!target) return;

    const items = map[target];
    if (linksToBlogs(items)) return;
    // Any menu already linking blogs counts — the merchant may have put it in
    // the footer instead, and two Blog links is worse than none.
    if (handles.some((h) => linksToBlogs(map[h]))) return;

    map[target] = [
      ...items,
      {
        id: "numu-auto-blog",
        label: { en: "Blog", ar: "المدونة" },
        url: "/blogs",
        type: "http",
        children: [],
      },
    ];
  } catch {
    /* menus render unchanged */
  }
}

// ── Content pages (Phase 4.4b) ──────────────────────────────────────────────

export interface StorefrontPage {
  id: string;
  handle: string;
  title: Record<string, string>;
  body: Record<string, string>;
  seo: Record<string, unknown>;
  template: string;
  /** Public merchant-defined typed fields (private ones never leave the API). */
  metafields?: { namespace: string; key: string; type: string; value: unknown }[];
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
