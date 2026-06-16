/**
 * Single-blog article list — Phase 1.8 stub.
 *
 * Routes the customer to a list of articles for a specific blog
 * handle. Same BYOT-aware shape as the other storefront pages.
 */

import { fetchStoreByDomain, fetchThemeSettings } from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import {
  fetchBlogByHandle,
  fetchArticlesList,
  type ArticleSummary,
} from "@/lib/blogs";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string; blog: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { domain, blog: handle } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    const blog = await fetchBlogByHandle(store.id, handle).catch(() => null);
    return {
      title: blog ? `${blog.title} | ${store.name}` : `Blog | ${store.name}`,
    };
  } catch {
    return { title: "Blog" };
  }
}

export default async function BlogPage({ params }: PageProps) {
  const { domain, blog: handle } = await params;

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

  const blog = await fetchBlogByHandle(store.id, handle).catch(() => null);
  if (!blog) {
    // Backend not deployed OR blog truly missing — `notFound()` triggers
    // [domain]/not-found.tsx, which themes can customize via the 404
    // template. Avoids a hardcoded 404 for stores that never enabled blogs.
    notFound();
  }

  const articles = await fetchArticlesList(store.id, handle).catch(
    () => [] as ArticleSummary[],
  );

  const themeRaw = await fetchThemeSettings(store.id).catch(() => null);
  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});

  // Built-in article list + ENG-2 no-blank backstop for themes with no `blog`
  // template.
  const builtInBlog = (
    <main className="max-w-3xl mx-auto px-4 py-12" id="main">
      <h1 className="text-3xl font-semibold mb-2">{blog.title}</h1>
      {blog.description && (
        <p className="text-gray-600 mb-6">{blog.description}</p>
      )}
      {articles.length === 0 ? (
        <p className="text-gray-600">No articles in this blog yet.</p>
      ) : (
        <ul className="space-y-6">
          {articles.map((a) => (
            <li key={a.handle}>
              <Link
                href={`/${domain}/blogs/${blog.handle}/${a.handle}`}
                className="text-xl font-medium underline text-blue-700"
              >
                {a.title}
              </Link>
              {a.published_at && (
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(a.published_at).toLocaleDateString()}
                </p>
              )}
              {a.excerpt && (
                <p className="text-gray-700 text-sm mt-2">{a.excerpt}</p>
              )}
            </li>
          ))}
        </ul>
      )}
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
          type: "blog",
          title: blog.title,
          handle: blog.handle,
          data: { blog, articles },
        }}
        routeFallback={builtInBlog}
      />
    );
  }

  return builtInBlog;
}
