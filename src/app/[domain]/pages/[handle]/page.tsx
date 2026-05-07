/**
 * /pages/[handle] — generic CMS page route.
 *
 * The platform doesn't yet have a "pages" content model on the backend
 * (Shopify-style /pages/about, /pages/shipping, etc.). This route still
 * exists because BYOT themes commonly link to /pages/<slug> from
 * footer / nav menus and we want those links to render *something*
 * coherent rather than a 404.
 *
 * What it does today:
 *   - Resolves store + theme.
 *   - For BYOT themes: hands `page.type = "page"`, `page.handle = <slug>`
 *     to the bundle, with no `body` data. The bundle's `page_content`
 *     section can render either a placeholder ("This page has no
 *     content yet") or, if the theme uses section blocks for content,
 *     render those.
 *   - For built-in themes: renders the `page` template with no data.
 *
 * When the CMS pages backend ships, this route will fetch the actual
 * page record by handle and pass it through `page.data.page`. Themes
 * that already consume `page.data.page` (per the SDK contract) won't
 * need any changes when that lands.
 */
import {
  fetchStoreByDomain,
  fetchThemeSettings,
} from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { PageTemplateRenderer } from "@/components/theme-engine/PageTemplateRenderer";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string; handle: string }>;
}

function humanize(handle: string): string {
  return handle
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain, handle } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    return {
      title: `${humanize(handle)} | ${store?.name || "Store"}`,
    };
  } catch {
    return { title: humanize(handle) };
  }
}

export default async function CmsPage({ params }: PageProps) {
  const { domain, handle } = await params;

  let store;
  try {
    store = await fetchStoreByDomain(domain);
  } catch {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Store not found
      </div>
    );
  }

  const themeRaw = await fetchThemeSettings(store.id).catch(() => null);
  if (!themeRaw) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        No theme installed.
      </div>
    );
  }
  const themeSettings = resolveThemeSettings(
    themeRaw?.theme_settings || themeRaw || {},
  );

  if (
    themeSettings.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id)
  ) {
    return (
      <ByotThemeBoundary
        bundleUrl={themeSettings.external_theme.bundle_url}
        cssUrl={themeSettings.external_theme.css_url}
        themeSettings={themeSettings}
        storeData={store}
        page={{
          type: "page",
          title: humanize(handle),
          handle,
          // body intentionally absent — CMS pages backend not yet
          // available. Themes' page_content section should render a
          // graceful placeholder when page.data.page.body is null.
          data: { page: { handle, title: humanize(handle), body: null } },
        }}
      />
    );
  }

  const pageTemplate = themeSettings.templates?.page;
  if (pageTemplate) {
    return (
      <PageTemplateRenderer
        template={pageTemplate}
        themeId={themeSettings.theme_id}
        storeData={store}
      />
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold">{humanize(handle)}</h1>
      <p className="text-gray-600 mt-4">No content yet.</p>
    </div>
  );
}
