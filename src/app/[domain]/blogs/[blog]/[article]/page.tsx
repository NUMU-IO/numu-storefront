/**
 * Single article — Phase 1.8 stub.
 *
 * Nested under `/blogs/{blog}/{article}`. Same BYOT-aware shape as
 * the other storefront pages.
 */

import { fetchStoreByDomain, fetchThemeSettings } from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import { fetchArticleByHandle } from "@/lib/blogs";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string; blog: string; article: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { domain, blog, article } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    const a = await fetchArticleByHandle(store.id, blog, article).catch(
      () => null,
    );
    return {
      title: a ? `${a.title} | ${store.name}` : `Article | ${store.name}`,
      description: a?.excerpt || undefined,
    };
  } catch {
    return { title: "Article" };
  }
}

export default async function ArticlePage({ params }: PageProps) {
  const { domain, blog, article } = await params;

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

  const a = await fetchArticleByHandle(store.id, blog, article).catch(
    () => null,
  );
  if (!a) {
    notFound();
  }

  const themeRaw = await fetchThemeSettings(store.id).catch(() => null);
  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});

  // Built-in article + ENG-2 no-blank backstop for themes with no `article`
  // template.
  const builtInArticle = (
    <main className="max-w-3xl mx-auto px-4 py-12" id="main">
      <article>
        <h1 className="text-3xl font-semibold mb-2">{a.title}</h1>
        {a.published_at && (
          <p className="text-sm text-gray-500 mb-6">
            {new Date(a.published_at).toLocaleDateString()}
            {a.author ? ` · by ${a.author}` : ""}
          </p>
        )}
        {/* body_html is merchant-authored and arrives UN-sanitized from the
            backend (see lib/blogs.ts). Sanitize here before it reaches
            dangerouslySetInnerHTML (stored XSS). BYOT themes receive the raw
            article and sanitize via the SDK's <RichText>. */}
        <div
          className="prose max-w-none"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(a.body_html) }}
        />
      </article>
    </main>
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
          type: "article",
          title: a.title,
          handle: a.handle,
          data: { article: a, blog_handle: blog },
        }}
        routeFallback={builtInArticle}
      />
    );
  }

  return builtInArticle;
}
