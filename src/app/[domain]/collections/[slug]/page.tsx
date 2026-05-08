import { fetchStoreByDomain, fetchCollectionBySlug, fetchThemeSettings } from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { PageTemplateRenderer } from "@/components/theme-engine/PageTemplateRenderer";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import {
  buildBreadcrumbLd,
  buildCollectionLd,
  serializeLd,
} from "@/lib/json-ld";
import type { Metadata } from "next";

/**
 * Phase 4.7 — ISR cache: revalidate every 5 minutes.
 *
 * Collection pages aggregate product listings; the same cache
 * pressure analysis as PDPs applies. The API client's
 * `collection:${storeId}:${slug}` revalidation tag fires sooner on
 * explicit publishes (a merchant adding/removing products from a
 * collection invalidates this cache via the hub's publish flow).
 */
export const revalidate = 300;

interface PageProps {
  params: Promise<{ domain: string; slug: string }>;
}

function storeBaseUrl(domain: string): string {
  const platformDomain = process.env.NUMU_PLATFORM_DOMAIN || "numueg.app";
  const isProd = process.env.NEXT_PUBLIC_NUMU_ENV === "production";
  return isProd
    ? `https://${domain}.${platformDomain}`
    : `http://localhost:3000/${domain}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain, slug } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    const collection = await fetchCollectionBySlug(store.id, slug);
    return {
      title: `${collection?.name || "Collection"} | ${store?.name || "Store"}`,
      description: collection?.description || "",
      alternates: {
        canonical: `${storeBaseUrl(domain)}/collections/${slug}`,
      },
      openGraph: {
        title: collection?.name,
        description: collection?.description,
        type: "website",
        images: collection?.image_url ? [collection.image_url] : undefined,
      },
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

  // JSON-LD: emit a CollectionPage block + breadcrumbs so search
  // engines surface "Collection: <name>" results with the right URL.
  const baseUrl = storeBaseUrl(domain);
  const collectionLd = collection
    ? buildCollectionLd({ collection, baseUrl })
    : null;
  const breadcrumbLd = collection
    ? buildBreadcrumbLd({
        trail: [
          { name: "Home", url: baseUrl },
          { name: "Collections", url: `${baseUrl}/collections/all` },
          { name: collection.name || "Collection" },
        ],
      })
    : null;
  const ldBlocks = [collectionLd, breadcrumbLd].filter(Boolean);
  const ldScripts = ldBlocks.map((ld, i) => (
    <script
      key={`ld-${i}`}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeLd(ld) }}
    />
  ));

  // BYOT: hand the bundle the page context so it knows to render its
  // collection template. Same fork the home route uses.
  if (
    themeSettings.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id)
  ) {
    return (
      <>
        {ldScripts}
        <ByotThemeBoundary
          bundleUrl={themeSettings.external_theme.bundle_url}
          cssUrl={themeSettings.external_theme.css_url}
          themeSettings={themeSettings}
          storeData={store}
          page={{
            type: "collection",
            title: collection?.name,
            handle: slug,
            data: collection ? { collection } : undefined,
          }}
        />
      </>
    );
  }

  const collectionTemplate = themeSettings.templates?.collection;
  if (collectionTemplate) {
    return (
      <>
        {ldScripts}
        <PageTemplateRenderer
          template={collectionTemplate}
          themeId={themeSettings.theme_id}
          storeData={store}
        />
      </>
    );
  }

  return (
    <>
      {ldScripts}
      <div className="max-w-4xl mx-auto p-8">
        <h1 className="text-3xl font-bold">{collection?.name || "Collection"}</h1>
        <p className="text-gray-600 mt-4">{collection?.description || ""}</p>
      </div>
    </>
  );
}
