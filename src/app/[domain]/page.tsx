import { fetchStoreByDomain, fetchThemeSettings, fetchProducts, fetchCollections } from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { PageTemplateRenderer } from "@/components/theme-engine/PageTemplateRenderer";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";

interface PageProps {
  params: Promise<{ domain: string }>;
}

export default async function HomePage({ params }: PageProps) {
  const { domain } = await params;

  const store = await fetchStoreByDomain(domain);
  const themeRaw = await fetchThemeSettings(store.id);
  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});

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
