/**
 * /search?q=… — search results route.
 *
 * Today the backend has no full-text product search endpoint, so this
 * route does a coarse client-server hybrid: it pre-fetches the store's
 * products list (same source as the home route) and passes them through
 * as `page.data.products`. The bundle's search section is expected to
 * filter client-side by name/description match against `q`.
 *
 * The same match also runs on the SERVER for the `seoContent` layer below, so
 * the route answers a plain `?q=` GET with real results and a real input in the
 * initial HTML — no JavaScript required.
 *
 * When a real `/storefront/search` endpoint ships (predictive +
 * faceted), this route will swap to that with no theme changes — the
 * bundle's `useSearch` hook is the eventual seam.
 */
import {
  fetchStoreByDomain,
  fetchThemeSettings,
  fetchProducts,
  fetchCollections,
} from "@/lib/api-client";
import { headers } from "next/headers";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { PageTemplateRenderer } from "@/components/theme-engine/PageTemplateRenderer";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import BuiltInSearchResults from "@/components/storefront/BuiltInSearchResults";
import { FunnelTracker } from "@/components/tracking/FunnelTracker";
import { NOINDEX_ROBOTS } from "@/lib/seo";
import {
  productHref,
  type SsrProductLike,
} from "@/components/seo/SsrContentLayer";
import { formatMajor } from "@/lib/money";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ q?: string }>;
}

/** Same name+description match BuiltInSearchResults applies client-side. */
function matchesQuery(p: SsrProductLike, q: string): boolean {
  if (!q) return true;
  const hay = `${p.name ?? p.title ?? ""} ${p.description ?? ""}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}

/**
 * ADR-7 — the crawler-facing / no-JS search layer.
 *
 * `curl /search` returned 200 with ~349 KB of payload, ZERO `<input>` elements
 * and 55 characters of visible text ("Skip to content Loading…"): the field and
 * the grid are both drawn by the theme bundle, so every no-JS visitor, every
 * crawler, and every curl-based audit correctly concluded the store has no
 * search — even though the client-rendered one works fine.
 *
 * This renders a REAL GET form plus the server-filtered matches into the
 * initial response, so search works with JavaScript switched off (the browser
 * navigates to /search?q=… and this same render answers it). ByotThemeBoundary
 * drops the whole layer the instant React hydrates — before the bundle has even
 * finished downloading — so a real visitor never sees it beside the theme.
 *
 * Copy mirrors BuiltInSearchResults (the with-JS backstop) so the two never
 * read as two different features. Deliberately text-only: unlike the collection
 * layer this skips product thumbnails, because 60 lazy image requests would
 * still be issued by the browser before hydration throws the markup away.
 */
function SsrSearchContent({
  products,
  query,
  storeCurrency,
  locale,
}: {
  products: SsrProductLike[];
  query: string;
  storeCurrency?: string | null;
  locale?: string;
}) {
  const ar = (locale || "en").toLowerCase().startsWith("ar");
  const q = query.trim();
  // Never throw — a failed catalog fetch degrades to "form only", not a 500.
  const list = Array.isArray(products) ? products : [];
  // No query means no results — NOT the whole catalogue. Falling back to `list`
  // made a bare /search render "250 results" and 60 product cards, which reads
  // as a listing page, duplicates /products for a crawler, and buries the one
  // control the visitor actually came for. An empty search shows the form and
  // the prompt only; `t.empty` already carries the right copy for this case.
  const results = q ? list.filter((p) => matchesQuery(p, q)) : [];
  const shown = results.slice(0, 60);
  const t = {
    title: ar ? "نتائج البحث" : "Search",
    placeholder: ar ? "ابحث عن المنتجات…" : "Search products…",
    submit: ar ? "بحث" : "Search",
    count: ar
      ? `${results.length} نتيجة`
      : `${results.length} ${results.length === 1 ? "result" : "results"}`,
    empty: ar
      ? q
        ? `لا توجد نتائج لـ "${q}".`
        : "اكتب كلمة للبحث عن المنتجات."
      : q
        ? `No results for "${q}".`
        : "Type a term to search products.",
    all: ar ? "كل المنتجات" : "All products",
  };

  return (
    <div
      dir={ar ? "rtl" : "ltr"}
      className="mx-auto max-w-6xl px-4 py-8 [font-family:var(--numu-sans)] text-[var(--numu-ink)]"
    >
      <h1 className="text-2xl font-bold [font-family:var(--numu-display)]">
        {q ? `${t.title}: ${q}` : t.title}
      </h1>

      {/* A plain GET form — no JS, no handler: the browser submits to
          /search?q=… and the server render above answers with the matches. */}
      <form
        method="get"
        action="/search"
        role="search"
        className="mt-4 flex max-w-md gap-2"
      >
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={t.placeholder}
          aria-label={t.placeholder}
          className="w-full rounded-[var(--numu-radius)] border border-[var(--numu-border)] bg-[var(--numu-surface)] px-4 py-2.5 text-sm outline-none"
        />
        <button
          type="submit"
          className="rounded-[var(--numu-radius)] border border-[var(--numu-border)] px-4 py-2.5 text-sm font-medium"
        >
          {t.submit}
        </button>
      </form>

      {/* Only meaningful once something was searched for. On a bare /search the
          count would read "0 results", which implies a failed search rather
          than one not yet made. */}
      {q && <p className="mt-4 text-sm text-[var(--numu-ink-soft)]">{t.count}</p>}

      {shown.length === 0 ? (
        <p className="mt-6">
          {t.empty}{" "}
          <a href="/products" className="underline underline-offset-2">
            {t.all}
          </a>
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((p, i) => {
            const name =
              (p.name || p.title || "").trim() || (ar ? "منتج" : "Product");
            const price =
              typeof p.price === "number" && Number.isFinite(p.price)
                ? formatMajor(p.price, p.currency || storeCurrency || "EGP")
                : null;
            return (
              <li key={p.id || p.slug || `${name}-${i}`}>
                <a href={productHref(p)} className="underline underline-offset-2">
                  {name}
                </a>
                {price && (
                  <span className="ms-2 text-sm text-[var(--numu-ink-soft)]">
                    {price}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// Entity title only — the `[domain]` layout's title template appends the store
// name, so this no longer needs to resolve the store at all.
export async function generateMetadata({
  searchParams,
}: PageProps): Promise<Metadata> {
  const { q } = await searchParams;
  return {
    title: q ? `Search "${q}"` : "Search",
    robots: NOINDEX_ROBOTS,
  };
}

export default async function SearchPage({
  params,
  searchParams,
}: PageProps) {
  const { domain } = await params;
  const { q = "" } = await searchParams;

  // Meta Search — fires once per query per session. Rendered in every branch.
  const searchTracker = q ? (
    <FunnelTracker
      step="search"
      data={{ search_string: q }}
      dedupeKey={`search_${q}`}
    />
  ) : null;

  let store;
  try {
    store = await fetchStoreByDomain(domain);
  } catch {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Store not found
      </div>
    );
  }

  const themeRaw = await fetchThemeSettings(store.id).catch(() => null);
  if (!themeRaw) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        No theme installed.
      </div>
    );
  }
  const themeSettings = resolveThemeSettings(
    themeRaw?.theme_settings || themeRaw || {},
  );

  // Pre-fetch the catalog + collections so the bundle can do client-side
  // filtering. The cap has to cover the WHOLE catalog, not a page of it: at 100
  // a 250-product store left ~60% of its products unfindable — `?q=Winter
  // Shawl` answered "No matches" while /products/winter-shawl-red existed and
  // was in stock, which reads as a broken search rather than a paging limit.
  // 1000 matches what sitemap.ts already fetches per request. This stays a
  // client-side filter over one prefetch until a real backend search endpoint
  // exists; at that point this whole block collapses to a single search call.
  const [products, collections] = await Promise.all([
    fetchProducts(store.id, 1000).catch(() => []),
    fetchCollections(store.id).catch(() => []),
  ]);

  // ENG-3: visitor locale for the bilingual built-in search fallback.
  const hl = await headers();
  const locale =
    hl.get("x-numu-locale") ||
    (store as { default_language?: string })?.default_language ||
    "en";

  if (
    themeSettings.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id)
  ) {
    return (
      <>
        {searchTracker}
        <ByotThemeBoundary
          bundleUrl={themeSettings.external_theme.bundle_url}
          bundleChecksum={themeSettings.external_theme.checksum}
          cssUrl={themeSettings.external_theme.css_url}
          themeSettings={themeSettings}
          storeData={store}
          page={{
            type: "search",
            title: q ? `Search: ${q}` : "Search",
            data: { query: q, products, collections },
          }}
          // ENG-2: themes that ship no search template render blank — fall back
          // to the built-in results grid (filters the pre-fetched products
          // client-side) so search is never an empty page.
          routeFallback={
            <BuiltInSearchResults
              products={products}
              query={q}
              storeCurrency={store?.currency}
              locale={locale}
            />
          }
          // ADR-7 — a real GET form + the server-filtered matches in the initial
          // HTML, so /search is usable with no JavaScript and the input exists
          // for crawlers. Dropped on hydration; present even when the theme's
          // own search template renders.
          seoContent={
            <SsrSearchContent
              products={products}
              query={q}
              storeCurrency={store?.currency}
              locale={locale}
            />
          }
        />
      </>
    );
  }

  // Built-in fallback (a `search` template would be a future addition;
  // for now reuse home).
  const template =
    themeSettings.templates?.search ?? themeSettings.templates?.home;
  if (template) {
    return (
      <>
        {searchTracker}
        <PageTemplateRenderer
          template={template}
          themeId={themeSettings.theme_id}
          storeData={store}
        />
      </>
    );
  }

  return (
    <>
      {searchTracker}
      <div className="max-w-4xl mx-auto p-8">
        <h1 className="text-3xl font-bold">Search</h1>
        <p className="text-gray-600 mt-4">No search template configured.</p>
      </div>
    </>
  );
}
