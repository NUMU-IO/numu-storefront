import {
  fetchStoreByDomain,
  fetchThemeSettings,
  fetchProducts,
  fetchCollections,
} from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { PageTemplateRenderer } from "@/components/theme-engine/PageTemplateRenderer";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import type { Product, Collection } from "@/types";

interface PageProps {
  params: Promise<{ domain: string }>;
}

/**
 * Unwrap the api-client envelope. The backend wraps every list in
 * `{ data: [...] }`; older endpoints return the list directly. Accept
 * both — refusing one or the other makes the storefront brittle to
 * unrelated API tweaks.
 */
function unwrapList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === "object") {
    const r = raw as { data?: unknown; items?: unknown };
    if (Array.isArray(r.data)) return r.data as T[];
    if (Array.isArray(r.items)) return r.items as T[];
  }
  return [];
}

export default async function HomePage({ params }: PageProps) {
  const { domain } = await params;

  const store = await fetchStoreByDomain(domain);

  // Fetch theme + catalog in parallel — both are independent of each
  // other and serializing them would add a needless round-trip to TTFB.
  // Failures on catalog don't block render: themes are expected to
  // handle an empty list via their own empty state (the home page is
  // useful even without products on a brand-new store).
  const [themeRaw, productsRaw, collectionsRaw] = await Promise.all([
    fetchThemeSettings(store.id),
    fetchProducts(store.id).catch(() => null),
    fetchCollections(store.id).catch(() => null),
  ]);

  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});
  const products = unwrapList<Product>(productsRaw);
  const collections = unwrapList<Collection>(collectionsRaw);

  // BYOT: render client-side
  if (themeSettings.external_theme?.bundle_url && !isBuiltInTheme(themeSettings.theme_id)) {
    return (
      <ByotThemeBoundary
        bundleUrl={themeSettings.external_theme.bundle_url}
        cssUrl={themeSettings.external_theme.css_url}
        themeSettings={themeSettings}
        storeData={store}
        products={products}
        collections={collections}
      />
    );
  }

  // Built-in: render server-side
  const homeTemplate = themeSettings.templates?.home;
  if (!homeTemplate) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">No home template configured</div>;
  }

  return (
    <PageTemplateRenderer
      template={homeTemplate}
      themeId={themeSettings.theme_id}
      storeData={store}
    />
  );
}
