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
import { resolveThemeSettings, applyTemplateOverride } from "@/lib/resolve-theme";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { catchAllOwnsHandle } from "@/lib/content-pages";
import { alternatesFor, type StoreForSeo } from "@/lib/seo";
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

    // Duplicate-URL consolidation. A handle the `[...slug]` catch-all serves —
    // because the theme templates it, or because this very CMS record backs it
    // — is ALSO reachable at `/{handle}`, which is the designed page the theme's
    // own nav points at. That URL is the original, so this plainer copy
    // canonicalises into it instead of competing with it. Same predicate as the
    // catch-all's self-canonical, so the two can't both claim to be the
    // original; a handle with no twin (the catch-all 404s it) stays
    // self-canonical here.
    const themeRaw = await fetchThemeSettings(store.id).catch(() => null);
    const themeSettings = themeRaw
      ? resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {})
      : null;
    const hasBody = pick(page?.body, lang).trim().length > 0;
    const canonicalPath = catchAllOwnsHandle(handle, themeSettings, hasBody)
      ? `/${handle}`
      : `/pages/${handle}`;

    return {
      title,
      ...(description ? { description } : {}),
      alternates: alternatesFor(
        store as unknown as StoreForSeo,
        domain,
        canonicalPath,
      ),
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
  // Merchant-authored HTML → sanitize before any dangerouslySetInnerHTML.
  // Used by BOTH built-in render paths below (routeFallback + no-template
  // fallback). BYOT themes receive the raw body and sanitize via the SDK's
  // <RichText>. See src/lib/sanitize-html.ts.
  const safeBody = resolvedBody ? sanitizeHtml(resolvedBody) : null;

  // Template overrides: honour an alternate page template (page.template_suffix
  // → `page.<suffix>`) in both the BYOT and built-in render paths.
  const effectiveTheme = applyTemplateOverride(
    themeSettings,
    "page",
    (page as { template_suffix?: string | null } | null)?.template_suffix ?? null,
  );

  if (
    themeSettings.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id)
  ) {
    return (
      <ByotThemeBoundary
        bundleUrl={themeSettings.external_theme.bundle_url}
        bundleChecksum={themeSettings.external_theme.checksum}
        cssUrl={themeSettings.external_theme.css_url}
        themeSettings={effectiveTheme}
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
              // Public merchant-defined fields — read by the SDK's
              // useMetafield("page", ns, key). The backend only ever
              // sends public ones, so passing through is safe.
              metafields: page?.metafields ?? [],
            },
          },
        }}
        // ENG-2: themes that ship no `page` template render blank — render the
        // real CMS title+body (same markup as the built-in branch below) so a
        // published content page is never a blank white screen.
        routeFallback={
          <div className="max-w-4xl mx-auto p-8">
            <h1 className="text-3xl font-bold">{resolvedTitle}</h1>
            {safeBody ? (
              <div
                className="prose mt-4 max-w-none"
                dangerouslySetInnerHTML={{ __html: safeBody }}
              />
            ) : (
              <p className="text-gray-600 mt-4">No content yet.</p>
            )}
          </div>
        }
      />
    );
  }

  const pageTemplate = effectiveTheme.templates?.page;
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
      {safeBody ? (
        <div
          className="prose mt-4 max-w-none"
          dangerouslySetInnerHTML={{ __html: safeBody }}
        />
      ) : (
        <p className="text-gray-600 mt-4">No content yet.</p>
      )}
    </div>
  );
}
