import {
  fetchStoreByDomain,
  fetchThemeSettings,
  fetchProducts,
} from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import type { Metadata } from "next";

/**
 * Products listing page — Phase 2 of the V3 multipage roll-out.
 *
 * Sibling of /collections/[slug] but with no collection scope; this is
 * the "all products" entry point that previously didn't exist as its
 * own route. The editor V3 template selector points the iframe here
 * when the merchant picks the "Products" template; the bundle reads
 * `page.type === "products"` to render its listing preset.
 *
 * Built-in (V2) themes don't have an equivalent template — they
 * historically rendered a category-style listing under
 * `/collections/all` via the in-tree theme engine. Until those themes
 * migrate to BYOT, the V2 fallback below short-circuits with a
 * minimal placeholder.
 */

// 60-second ISR like the home page. Product list rarely changes vs
// individual product detail (where pricing/inventory matter more), so
// a one-minute window is comfortable.
export const revalidate = 60;

interface PageProps {
  params: Promise<{ domain: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { domain } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    return {
      title: `Products | ${store?.name || "Store"}`,
      description: `Browse all products from ${store?.name || domain}.`,
    };
  } catch {
    return { title: "Products" };
  }
}

export default async function ProductsListingPage({ params }: PageProps) {
  const { domain } = await params;

  const store = await fetchStoreByDomain(domain);
  const themeRaw = await fetchThemeSettings(store.id);
  const themeSettings = resolveThemeSettings(
    themeRaw?.theme_settings || themeRaw || {},
  );

  if (
    themeSettings.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id)
  ) {
    // Pull a starter batch the bundle can render against. The bundle's
    // own grid section can request more via `useProducts({ limit })`
    // if it wants pagination; this lands a sensible default for the
    // common "show a grid of 50" case.
    const products = await fetchProducts(store.id, 50).catch(() => []);
    return (
      <ByotThemeBoundary
        bundleUrl={themeSettings.external_theme.bundle_url}
        cssUrl={themeSettings.external_theme.css_url}
        themeSettings={themeSettings}
        storeData={store}
        page={{
          type: "products",
          title: "All products",
          data: { products },
        }}
      />
    );
  }

  // V2 themes don't have a `products` template surface. A real listing
  // requires migrating the theme to BYOT or wiring an explicit V2
  // fallback in PageTemplateRenderer; the latter is out of scope here.
  return (
    <div className="min-h-screen flex items-center justify-center text-gray-500 px-6 text-center">
      Products listing requires a V3 (BYOT) theme. Switch your active
      theme in Admin → Themes.
    </div>
  );
}
