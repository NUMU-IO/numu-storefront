import { fetchStoreByDomain, fetchThemeSettings } from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { SectionGroupRenderer } from "@/components/theme-engine/SectionGroupRenderer";
import { ThemeDataProvider } from "@/components/layout/ThemeDataProvider";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import type { Metadata } from "next";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ domain: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ domain: string }> }): Promise<Metadata> {
  const { domain } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    return {
      title: store?.name || "NUMU Store",
      description: store?.description || "Powered by NUMU",
    };
  } catch {
    return { title: "NUMU Store" };
  }
}

export default async function StoreLayout({ children, params }: LayoutProps) {
  const { domain } = await params;

  let store, themeRaw;
  try {
    store = await fetchStoreByDomain(domain);
    themeRaw = await fetchThemeSettings(store.id);
  } catch {
    return <div className="min-h-screen flex items-center justify-center">Store not found</div>;
  }

  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});
  const isByot = !!themeSettings.external_theme?.bundle_url && !isBuiltInTheme(themeSettings.theme_id);

  return (
    <ThemeDataProvider themeSettings={themeSettings} storeData={store}>
      {!isByot && themeSettings.section_groups?.header && (
        <SectionGroupRenderer
          group={themeSettings.section_groups.header}
          themeId={themeSettings.theme_id}
          storeData={store}
        />
      )}
      {children}
      {!isByot && themeSettings.section_groups?.footer && (
        <SectionGroupRenderer
          group={themeSettings.section_groups.footer}
          themeId={themeSettings.theme_id}
          storeData={store}
        />
      )}
    </ThemeDataProvider>
  );
}
