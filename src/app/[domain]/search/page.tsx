/**
 * /search?q=… — search results route.
 *
 * Today the backend has no full-text product search endpoint, so this
 * route does a coarse client-server hybrid: it pre-fetches the store's
 * products list (same source as the home route) and passes them through
 * as `page.data.products`. The bundle's search section is expected to
 * filter client-side by name/description match against `q`.
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
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({
  params,
  searchParams,
}: PageProps): Promise<Metadata> {
  const { domain } = await params;
  const { q } = await searchParams;
  try {
    const store = await fetchStoreByDomain(domain);
    return {
      title: q
        ? `Search "${q}" | ${store?.name || "Store"}`
        : `Search | ${store?.name || "Store"}`,
      robots: NOINDEX_ROBOTS,
    };
  } catch {
    return { title: "Search", robots: NOINDEX_ROBOTS };
  }
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

  // Pre-fetch a large product slice + collections so the bundle can do
  // client-side filtering. When the real /storefront/search ships we
  // replace this with a single search call.
  const [products, collections] = await Promise.all([
    fetchProducts(store.id, 100).catch(() => []),
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
