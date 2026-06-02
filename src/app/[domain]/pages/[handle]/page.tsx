/**
 * /pages/[handle] — merchant content page route (Phase 4.4b).
 *
 * Resolves the real Page record from the backend
 * (`GET /storefront/store/{id}/pages/{handle}`, published only) and hands
 * its bilingual title/body/SEO to the theme via `page.data.page`. BYOT
 * themes' page-content section renders `page.data.page.body`; built-in
 * themes render the `page` template. When no published page exists for the
 * handle, we fall back to a humanized placeholder so theme nav links to
 * `/pages/<slug>` never hard-404.
 */
import {
  fetchStoreByDomain,
  fetchThemeSettings,
  fetchStorePage,
  type StorefrontPage,
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
  return handle.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Pick a bilingual value for a language with sensible fallbacks. */
function pick(map: Record<string, string> | undefined, lang: string): string {
  if (!map) return "";
  return map[lang] || map.en || map.ar || Object.values(map)[0] || "";
}

function seoStr(
  seo: Record<string, unknown> | undefined,
  key: string,
  lang: string,
): string {
  const node = (seo?.[key] ?? {}) as Record<string, string>;
  return pick(node, lang);
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain, handle } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    const lang = (store as { default_language?: string })?.default_language || "en";
    const page = await fetchStorePage(store.id, handle);
    const title =
      seoStr(page?.seo, "title", lang) ||
      pick(page?.title, lang) ||
      humanize(handle);
    const description = seoStr(page?.seo, "description", lang);
    return {
      title: `${title} | ${store?.name || "Store"}`,
      ...(description ? { description } : {}),
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

  // Fetch the real page (published only); null → humanized placeholder.
  const page: StorefrontPage | null = await fetchStorePage(store.id, handle).catch(
    () => null,
  );
  const lang = (store as { default_language?: string })?.default_language || "en";
  const resolvedTitle = pick(page?.title, lang) || humanize(handle);
  const resolvedBody = pick(page?.body, lang) || null;

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
          title: resolvedTitle,
          handle,
          // Real page record (bilingual). Themes' page-content section
          // renders `page.data.page.body`; absent → graceful placeholder.
          data: {
            page: {
              handle,
              title: resolvedTitle,
              body: resolvedBody,
              title_i18n: page?.title ?? null,
              body_i18n: page?.body ?? null,
              seo: page?.seo ?? null,
            },
          },
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

  // Built-in / no-template fallback: render the real body when present.
  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold">{resolvedTitle}</h1>
      {resolvedBody ? (
        <div
          className="prose mt-4 max-w-none"
          dangerouslySetInnerHTML={{ __html: resolvedBody }}
        />
      ) : (
        <p className="text-gray-600 mt-4">No content yet.</p>
      )}
    </div>
  );
}
