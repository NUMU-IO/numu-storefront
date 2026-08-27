import {
  fetchStoreByDomain,
  fetchThemeSettings,
  fetchProducts,
  fetchCollections,
} from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import { alternatesFor, type StoreForSeo } from "@/lib/seo";
import { SsrProductIndexContent } from "@/components/seo/SsrContentLayer";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { slimProductsForTheme } from "@/lib/slim-product";

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
      // Entity title only — the layout's template appends the store name.
      title: "Products",
      description: `Browse all products from ${store?.name || domain}.`,
      // Explicit, even though the layout now derives a per-URL canonical from
      // the proxy's pathname header: this route is the catalogue entry point
      // Google should index, so it must not depend on that header being
      // present. `openGraph` is deliberately NOT redeclared — it is inherited
      // from the layout (whose og:url is this URL), and redeclaring it here
      // would drop the store's social image and og:locale.
      alternates: alternatesFor(
        store as unknown as StoreForSeo,
        domain,
        "/products",
      ),
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
    // Pull the full catalog for the bundle to render — themes paginate
    // client-side, and capping this at 50 silently hid the rest of the
    // catalog on stores with more products (vionne has 250+). Collections
    // ride along so header nav (collections dropdown) renders here too,
    // not just on the home route.
    const [rawProducts, collections] = await Promise.all([
      fetchProducts(store.id, 500).catch(() => []),
      fetchCollections(store.id).catch(() => []),
    ]);
    // Admin-only columns stripped before these rows become RSC props — this
    // list is inlined into the document verbatim. See lib/slim-product.ts.
    const products = slimProductsForTheme(rawProducts);
    const hl = await headers();
    const locale =
      hl.get("x-numu-locale") ||
      (store as { default_language?: string })?.default_language ||
      "en";
    return (
      <ByotThemeBoundary
        bundleUrl={themeSettings.external_theme.bundle_url}
        bundleChecksum={themeSettings.external_theme.checksum}
        cssUrl={themeSettings.external_theme.css_url}
        themeSettings={themeSettings}
        storeData={store}
        locale={locale}
        page={{
          type: "products",
          title: "All products",
          data: { products, collections },
        }}
        // ADR-7. This route had NEITHER backstop: it shipped 45 characters of
        // visible text and no h1 while being sitemapped and index,follow.
        // Omitted on an empty catalogue so we don't publish a thinner page
        // than the theme would.
        seoContent={
          products.length > 0 ? (
            <SsrProductIndexContent
              products={products}
              storeName={store?.name}
              storeCurrency={(store as { currency?: string })?.currency}
              locale={locale}
            />
          ) : undefined
        }
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
