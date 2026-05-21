/**
 * Blog index — Phase 1.8.
 *
 * v1 scope per the audit plan: at least the routes exist so theme
 * nav menus don't 404. Backend tables + admin CRUD in the hub land
 * in a follow-up; for now this page enumerates whatever blogs the
 * backend exposes via /storefront/store/{id}/blogs and falls back
 * to an empty state when the endpoint isn't deployed yet.
 *
 * BYOT-aware: forks to ByotThemeBoundary like the rest of the
 * storefront routes, so themes can render a custom listing using
 * page.data.blogs when they want to. Built-in fallback ships a
 * minimal listing.
 */

import { fetchStoreByDomain, fetchThemeSettings } from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import { fetchBlogsList, type BlogSummary } from "@/lib/blogs";
import Link from "next/link";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { domain } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    return { title: `Blog | ${store?.name || "Store"}` };
  } catch {
    return { title: "Blog" };
  }
}

export default async function BlogsIndexPage({ params }: PageProps) {
  const { domain } = await params;

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
  const blogs = await fetchBlogsList(store.id).catch(() => [] as BlogSummary[]);

  // BYOT fork: hand the blog list off to the theme bundle. Themes
  // read page.data.blogs and render their own design; built-in
  // themes get the minimal fallback below.
  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});
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
        page={{ type: "blogs", title: "Blog", data: { blogs } }}
      />
    );
  }

  return (
    <main className="max-w-3xl mx-auto px-4 py-12" id="main">
      <h1 className="text-3xl font-semibold mb-6">Blog</h1>
      {blogs.length === 0 ? (
        <p className="text-gray-600">No posts yet — check back soon.</p>
      ) : (
        <ul className="space-y-4">
          {blogs.map((b) => (
            <li key={b.handle}>
              <Link
                href={`/${domain}/blogs/${b.handle}`}
                className="text-xl font-medium underline text-blue-700"
              >
                {b.title}
              </Link>
              {b.description && (
                <p className="text-gray-600 text-sm mt-1">{b.description}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
