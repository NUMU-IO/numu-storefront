import {
  fetchStoreByDomain,
  fetchCollectionBySlug,
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
    const collection = await fetchCollectionBySlug(store.id, slug);
    return {
      title: `${collection?.name || "Collection"} | ${store?.name || "Store"}`,
    };
  } catch {
    return { title: "Collection" };
  }
}

export default async function CollectionPage({ params }: PageProps) {
  const { domain, slug } = await params;

  const store = await fetchStoreByDomain(domain);
  const collection = await fetchCollectionBySlug(store.id, slug);
  const [themeRaw, productsRaw, collectionsRaw] = await Promise.all([
    fetchThemeSettings(store.id),
    fetchProducts(store.id).catch(() => null),
    fetchCollections(store.id).catch(() => null),
  ]);

  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});
  const products = unwrapList<Product>(productsRaw);
  const collections = unwrapList<Collection>(collectionsRaw);

  if (themeSettings.external_theme?.bundle_url && !isBuiltInTheme(themeSettings.theme_id)) {
    return (
      <ByotThemeBoundary
        bundleUrl={themeSettings.external_theme.bundle_url}
        cssUrl={themeSettings.external_theme.css_url}
        themeSettings={themeSettings}
        storeData={store}
        products={products}
        collections={collections}
        currentTemplate="collection"
        currentCollection={collection}
      />
    );
  }

  const collectionTemplate = themeSettings.templates?.collection;
  if (collectionTemplate) {
    return (
      <PageTemplateRenderer
        template={collectionTemplate}
        themeId={themeSettings.theme_id}
        storeData={store}
      />
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold">{collection?.name || "Collection"}</h1>
      <p className="text-gray-600 mt-4">{collection?.description || ""}</p>
    </div>
  );
}
