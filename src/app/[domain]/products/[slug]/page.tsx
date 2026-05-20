import {
  fetchStoreByDomain,
  fetchProductBySlug,
  fetchThemeSettings,
  fetchProducts,
  fetchCollections,
} from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { PageTemplateRenderer } from "@/components/theme-engine/PageTemplateRenderer";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import type { Metadata } from "next";
import type { Product, Collection } from "@/types";

interface PageProps {
  params: Promise<{ domain: string; slug: string }>;
}

/**
 * Tolerates both the `{ data: [...] }` envelope the backend wraps lists
 * in and a raw array — defensive against unrelated API tweaks. Mirrors
 * the helper in /[domain]/page.tsx (intentional duplication; each page
 * is a server component and a shared module file just for this helper
 * would obscure that this is local glue, not a public contract).
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

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain, slug } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    const product = await fetchProductBySlug(store.id, slug);
    return {
      title: `${product?.name || "Product"} | ${store?.name || "Store"}`,
      description: product?.description || "",
    };
  } catch {
    return { title: "Product" };
  }
}

export default async function ProductPage({ params }: PageProps) {
  const { domain, slug } = await params;

  const store = await fetchStoreByDomain(domain);

  // Resource fetch first (product needed for both branches), then theme +
  // catalog in parallel. Catalog failures don't block render — themes
  // render empty states.
  const product = await fetchProductBySlug(store.id, slug);
  const [themeRaw, productsRaw, collectionsRaw] = await Promise.all([
    fetchThemeSettings(store.id),
    fetchProducts(store.id).catch(() => null),
    fetchCollections(store.id).catch(() => null),
  ]);

  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});
  const products = unwrapList<Product>(productsRaw);
  const collections = unwrapList<Collection>(collectionsRaw);

  // BYOT — render the theme bundle client-side, dispatched on the
  // `product` template so the bundle's section list for /product/[id]
  // takes precedence over its home template.
  if (themeSettings.external_theme?.bundle_url && !isBuiltInTheme(themeSettings.theme_id)) {
    return (
      <ByotThemeBoundary
        bundleUrl={themeSettings.external_theme.bundle_url}
        cssUrl={themeSettings.external_theme.css_url}
        themeSettings={themeSettings}
        storeData={store}
        products={products}
        collections={collections}
        currentTemplate="product"
        currentProduct={product}
      />
    );
  }

  // Built-in theme — server-render the `product` template if it exists,
  // otherwise fall back to a minimal product card.
  const productTemplate = themeSettings.templates?.product;
  if (productTemplate) {
    return (
      <PageTemplateRenderer
        template={productTemplate}
        themeId={themeSettings.theme_id}
        storeData={store}
      />
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold">{product?.name || "Product"}</h1>
      <p className="text-gray-600 mt-4">{product?.description || ""}</p>
      <p className="text-2xl font-bold mt-4">{product?.price || 0} {product?.currency || store?.currency}</p>
    </div>
  );
}
