import { fetchStoreByDomain, fetchCollectionBySlug, fetchThemeSettings } from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { PageTemplateRenderer } from "@/components/theme-engine/PageTemplateRenderer";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string; slug: string }>;
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
  const themeRaw = await fetchThemeSettings(store.id);
  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});

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
