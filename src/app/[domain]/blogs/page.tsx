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
import {
  fetchBlogsList,
  pickText,
  resolveVisitorLang,
  type BlogSummary,
} from "@/lib/blogs";
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
    const lang = await resolveVisitorLang(store);
    const heading = lang === "ar" ? "المدونة" : "Blog";
    // Entity title only — the layout's template appends the store name.
    return { title: heading };
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
  const lang = await resolveVisitorLang(store);
  const isAr = lang === "ar";

  // BYOT fork: hand the blog list off to the theme bundle. Themes
  // read page.data.blogs (bilingual dicts, localized via useLocale) and
  // render their own design; built-in themes get the fallback below.
  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});

  // Built-in listing + ENG-2 no-blank backstop: no theme currently ships a
  // `blogs` template, so without this the route would render blank wherever a
  // nav menu links to it.
  const builtInBlogs = (
    <main
      className="max-w-3xl mx-auto px-4 py-12"
      id="main"
      dir={isAr ? "rtl" : "ltr"}
    >
      <h1 className="text-3xl font-semibold mb-6">
        {isAr ? "المدونة" : "Blog"}
      </h1>
      {blogs.length === 0 ? (
        <p className="text-gray-600">
          {isAr
            ? "لا توجد مقالات بعد — تابعنا قريبًا."
            : "No posts yet — check back soon."}
        </p>
      ) : (
        <ul className="space-y-4">
          {blogs.map((b) => (
            <li key={b.handle}>
              <Link
                href={`/${domain}/blogs/${b.handle}`}
                className="text-xl font-medium underline text-blue-700"
              >
                {pickText(b.title, lang) || b.handle}
              </Link>
              {pickText(b.description ?? undefined, lang) && (
                <p className="text-gray-600 text-sm mt-1">
                  {pickText(b.description ?? undefined, lang)}
                </p>
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
        bundleChecksum={themeSettings.external_theme.checksum}
        cssUrl={themeSettings.external_theme.css_url}
        themeSettings={themeSettings}
        storeData={store}
        locale={lang}
        page={{
          type: "blogs",
          title: isAr ? "المدونة" : "Blog",
          data: { blogs },
        }}
        routeFallback={builtInBlogs}
      />
    );
  }

  return builtInBlogs;
}
