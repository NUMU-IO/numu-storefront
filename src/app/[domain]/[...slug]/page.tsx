/**
 * /[domain]/[...slug] — generic catch-all for any storefront path that
 * isn't served by a dedicated route (products, collections, cart, search,
 * pages, policies, blogs, account, checkout, …).
 *
 * Why this exists (the "ZERO page not found" guarantee):
 *   Themes author their own nav/footer links and frequently point at bare
 *   content paths — bon-younes hardcodes `/about`, `/contact`,
 *   `/testimonial`, `/gift-cards`, `/locations`, `/wholesale`, `/careers`.
 *   None of those match a literal route, so without this catch-all they
 *   fall through to Next's ROOT default 404 (unstyled, no theme chrome),
 *   which is the jarring "page not found" the merchant sees on every such
 *   link. Next gives static + nested-dynamic routes priority over a
 *   catch-all, so `/products`, `/collections/x`, `/cart`, etc. keep their
 *   dedicated routes; only genuinely-unmatched paths land here.
 *
 * Behavior (mirrors `pages/[handle]/page.tsx`, the established pattern):
 *   - Resolve store + theme.
 *   - For BYOT themes: hand the bundle `page.type = "page"` with the
 *     humanized handle so it renders its `page` template (header +
 *     content + footer) instead of a 404. When the CMS-pages backend
 *     ships, this route will fetch the real page record and pass it
 *     through `page.data.page`; themes already consuming that contract
 *     need no change.
 *   - For built-in themes: render the `page` template.
 *
 * Genuinely-missing RESOURCES (a bad product/collection id) still 404 via
 * their own route's notFound() → the theme's styled `404` template. This
 * catch-all only absorbs open-ended CONTENT/nav paths so they render a
 * coherent themed page rather than a dead end.
 */
import { fetchStoreByDomain, fetchThemeSettings } from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { PageTemplateRenderer } from "@/components/theme-engine/PageTemplateRenderer";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

// Open param set (can't generateStaticParams). Render on demand but CACHE
// per-path so a crawler walking random URLs can't force unbounded uncached
// SSR; identical paths reuse the cached render.
export const revalidate = 300;

interface PageProps {
  params: Promise<{ domain: string; slug: string[] }>;
}

function humanize(handle: string): string {
  return handle
    .split("/")
    .pop()!
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain, slug } = await params;
  const handle = (slug ?? []).join("/");
  // These synthesized pages render a placeholder until the CMS-pages backend
  // provides real content — don't let search engines index them.
  const robots = { index: false, follow: true };
  try {
    const store = await fetchStoreByDomain(domain);
    return {
      title: `${humanize(handle)} | ${store?.name || "Store"}`,
      robots,
    };
  } catch {
    return { title: humanize(handle), robots };
  }
}

export default async function CatchAllPage({ params }: PageProps) {
  const { domain, slug } = await params;
  const handle = (slug ?? []).join("/");

  // Bound crafted/garbage inputs: very deep or very long paths aren't real
  // content pages → themed 404 rather than an unbounded cached render.
  if ((slug?.length ?? 0) > 3 || handle.length > 120) {
    notFound();
  }

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
          // body absent until the CMS-pages backend lands; themes render
          // a graceful placeholder when page.data.page.body is null.
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
