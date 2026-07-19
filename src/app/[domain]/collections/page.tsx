import {
  fetchStoreByDomain,
  fetchThemeSettings,
  fetchCollections,
} from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import type { Metadata } from "next";

/**
 * Collections index — the "All collections" browse page.
 *
 * Sibling of /collections/[slug] (a single collection) but with no slug:
 * this is the top-level list of every collection. The header's COLLECTIONS
 * dropdown / mobile-drawer "All collections" link points here; before this
 * route existed it 404'd. The bundle reads `page.type === "collections"`
 * and renders its collections-index template (image cards).
 */

export const revalidate = 120;

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
      title: `Collections | ${store?.name || "Store"}`,
      description: `Browse every collection from ${store?.name || domain}.`,
    };
  } catch {
    return { title: "Collections" };
  }
}

export default async function CollectionsIndexPage({ params }: PageProps) {
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
    const collections = await fetchCollections(store.id).catch(() => []);
    return (
      <ByotThemeBoundary
        bundleUrl={themeSettings.external_theme.bundle_url}
        bundleChecksum={themeSettings.external_theme.checksum}
        cssUrl={themeSettings.external_theme.css_url}
        themeSettings={themeSettings}
        storeData={store}
        page={{
          type: "collections",
          title: "Collections",
          data: { collections },
        }}
      />
    );
  }

  // Built-in (V2) themes have no collections-index template.
  return (
    <div className="min-h-screen flex items-center justify-center text-gray-500 px-6 text-center">
      Collections listing requires a V3 (BYOT) theme. Switch your active
      theme in Admin → Themes.
    </div>
  );
}
