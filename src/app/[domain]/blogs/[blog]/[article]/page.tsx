/**
 * Single article — `/blogs/{blog}/{article}`.
 *
 * Same BYOT-aware shape as the other storefront pages, plus:
 *  - canonical redirect: a RENAMED article's old handle resolves
 *    server-side (backend previous_handles) and 308s to the new URL,
 *    so shared links never rot;
 *  - server-rendered Article JSON-LD + OG metadata (ADR-7: metadata is
 *    host-owned; themes influence it only through data).
 */

import { fetchStoreByDomain, fetchThemeSettings } from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { sanitizeHtml } from "@/lib/sanitize-html";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import {
  fetchArticleByHandle,
  pickText,
  resolveVisitorLang,
  type LocalizedText,
} from "@/lib/blogs";
import { notFound, permanentRedirect } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string; blog: string; article: string }>;
}

function seoText(
  seo: Record<string, unknown> | null | undefined,
  key: "title" | "description",
  lang: string,
): string {
  const map = seo?.[key];
  if (!map || typeof map !== "object") return "";
  return pickText(map as LocalizedText, lang);
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
    // Entity title only throughout — the `[domain]` layout's title template
    // appends the store name.
    if (!a) return { title: "Article" };
    const lang = await resolveVisitorLang(store);
    const title =
      seoText(a.seo, "title", lang) || pickText(a.title, lang) || a.handle;
    const description =
      seoText(a.seo, "description", lang) ||
      pickText(a.excerpt ?? undefined, lang) ||
      undefined;
    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: "article",
        ...(a.image_url ? { images: [{ url: a.image_url }] } : {}),
        ...(a.published_at ? { publishedTime: a.published_at } : {}),
      },
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

  // Renamed article: the backend resolved a former handle and returned the
  // CURRENT one — send crawlers and shoppers to the canonical URL.
  //
  // The `/[domain]/…` prefix has to be rebuilt by hand. On a real store the
  // proxy rewrites host→path, so the browser's URL has no store segment and a
  // bare `/blogs/…` is right. Under the local path-routing entry point
  // (127.0.0.1:3100/testlocal/…) the segment IS in the URL, and dropping it
  // sent the old link to a store-less path that renders "Store not found" —
  // i.e. exactly the rotted link this redirect exists to prevent.
  if (a.handle && a.handle !== article) {
    // `x-numu-host` is stamped only by the host→path rewrite branch, so its
    // ABSENCE is what identifies the path-routing entry point. (The pathname
    // header can't tell them apart — it carries the store segment either way,
    // because the rewrite puts it there.)
    const hl = await headers();
    const prefix = hl.get("x-numu-host") ? "" : `/${domain}`;
    permanentRedirect(`${prefix}/blogs/${blog}/${a.handle}`);
  }

  const lang = await resolveVisitorLang(store);
  const isAr = lang === "ar";
  const title = pickText(a.title, lang) || a.handle;
  const bodyHtml = pickText(a.body ?? undefined, lang);
  const safeBody = bodyHtml ? sanitizeHtml(bodyHtml) : "";

  const themeRaw = await fetchThemeSettings(store.id).catch(() => null);
  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});

  // Article JSON-LD — server-rendered for BOTH render paths (crawlers never
  // run the theme). Plain-text body excerpt only; full HTML stays out.
  const jsonLd = (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: title,
          ...(a.image_url ? { image: [a.image_url] } : {}),
          ...(a.published_at ? { datePublished: a.published_at } : {}),
          ...(a.author ? { author: { "@type": "Person", name: a.author } } : {}),
          publisher: { "@type": "Organization", name: store.name },
          description:
            pickText(a.excerpt ?? undefined, lang) ||
            // Strip from the SANITIZED body — a naive strip over the raw
            // body lets script-tag text leak into the description (QA
            // finding BLOG-OBS-1; SEO cleanliness, not XSS).
            safeBody.replace(/<[^>]+>/g, " ").trim().slice(0, 200),
        }),
      }}
    />
  );

  // Built-in article + ENG-2 no-blank backstop for themes with no `article`
  // template.
  const builtInArticle = (
    <main
      className="max-w-3xl mx-auto px-4 py-12"
      id="main"
      dir={isAr ? "rtl" : "ltr"}
    >
      <article>
        <h1 className="text-3xl font-semibold mb-2">{title}</h1>
        {a.published_at && (
          <p className="text-sm text-gray-500 mb-6">
            {new Date(a.published_at).toLocaleDateString(
              isAr ? "ar-EG" : "en-US",
            )}
            {a.author ? (isAr ? ` · بقلم ${a.author}` : ` · by ${a.author}`) : ""}
          </p>
        )}
        {/* Body is merchant-authored HTML and arrives UN-sanitized from the
            backend. Sanitize before dangerouslySetInnerHTML (stored XSS).
            BYOT themes receive the raw bilingual body and sanitize via the
            SDK's <RichText>. */}
        <div
          className="prose max-w-none"
          dangerouslySetInnerHTML={{ __html: safeBody }}
        />
      </article>
    </main>
  );

  if (
    themeSettings.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id)
  ) {
    return (
      <>
        {jsonLd}
        <ByotThemeBoundary
          bundleUrl={themeSettings.external_theme.bundle_url}
          bundleChecksum={themeSettings.external_theme.checksum}
          cssUrl={themeSettings.external_theme.css_url}
          themeSettings={themeSettings}
          storeData={store}
          locale={lang}
          page={{
            type: "article",
            title,
            handle: a.handle,
            data: { article: a, blog_handle: blog },
          }}
          routeFallback={builtInArticle}
        />
      </>
    );
  }

  return (
    <>
      {jsonLd}
      {builtInArticle}
    </>
  );
}
