import { fetchStoreByDomain, fetchThemeSettings, fetchProducts, fetchCollections } from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { PageTemplateRenderer } from "@/components/theme-engine/PageTemplateRenderer";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import {
  buildOrganizationLd,
  buildWebsiteLd,
  serializeLd,
} from "@/lib/json-ld";

interface PageProps {
  params: Promise<{ domain: string }>;
}

/**
 * Phase 4.7 — ISR cache: revalidate every 60s.
 *
 * The home page is the highest-traffic surface and the slowest to
 * regenerate (store + theme + products + collections roundtrips).
 * 60-second ISR + revalidation tags from the API client
 * (`store-${id}`, `theme-${id}`) means a publish from the merchant hub
 * triggers regeneration without a stale window past one minute.
 */
export const revalidate = 60;

export default async function HomePage({ params }: PageProps) {
  const { domain } = await params;

  const store = await fetchStoreByDomain(domain);
  const themeRaw = await fetchThemeSettings(store.id);
  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});

  // Phase 4.6 — Organization + WebSite JSON-LD on the home page.
  // Both are recommended by Google's rich-results guidelines:
  //   - Organization powers the Knowledge Graph card
  //   - WebSite + SearchAction enables the sitelinks search box
  const platformDomain = process.env.NUMU_PLATFORM_DOMAIN || "numueg.app";
  const isProd = process.env.NEXT_PUBLIC_NUMU_ENV === "production";
  const baseUrl = isProd
    ? `https://${(store as { custom_domain?: string }).custom_domain || `${domain}.${platformDomain}`}`
    : `http://localhost:3000/${domain}`;
  const organizationLd = buildOrganizationLd({
    baseUrl,
    storeName: store.name || domain,
    logoUrl: (store as { logo_url?: string }).logo_url ?? null,
    description: (store as { description?: string }).description ?? null,
    socialLinks:
      (store as { social_links?: Record<string, string> }).social_links ?? null,
  });
  const websiteLd = buildWebsiteLd({
    baseUrl,
    storeName: store.name || domain,
  });
  const ldScripts = (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeLd(organizationLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeLd(websiteLd) }}
      />
    </>
  );

  // BYOT: render client-side. Fetch a starter set of products + collections
  // so the bundle's home grids and category cards have real data to render
  // links against. Failures are non-fatal — the bundle's own sections
  // gracefully empty out.
  if (themeSettings.external_theme?.bundle_url && !isBuiltInTheme(themeSettings.theme_id)) {
    const [products, collections] = await Promise.all([
      fetchProducts(store.id, 20).catch(() => []),
      fetchCollections(store.id).catch(() => []),
    ]);
    return (
      <>
        {ldScripts}
        <ByotThemeBoundary
          bundleUrl={themeSettings.external_theme.bundle_url}
          cssUrl={themeSettings.external_theme.css_url}
          themeSettings={themeSettings}
          storeData={store}
          page={{
            type: "home",
            title: store.name,
            data: { products, collections },
          }}
        />
      </>
    );
  }

  // Built-in: render server-side
  const homeTemplate = themeSettings.templates?.home;
  if (!homeTemplate) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">No home template configured</div>;
  }

  return (
    <>
      {ldScripts}
      <PageTemplateRenderer
        template={homeTemplate}
        themeId={themeSettings.theme_id}
        storeData={store}
      />
    </>
  );
}
