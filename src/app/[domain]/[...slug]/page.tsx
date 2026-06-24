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
import { NumuDefaultShell } from "@/components/storefront/NumuDefaultShell";
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

// Standard storefront content pages that themes link to from their default
// nav/footer. Until the CMS-pages backend (Pages model) lands, a path whose
// first segment is one of these renders a themed placeholder PAGE (HTTP 200)
// so expected nav links are never dead ends. ANY other unmatched path is
// treated as genuinely missing → the theme's 404 template with a real HTTP
// 404 status (no soft-404 at 200). When the Pages model ships, replace this
// allowlist with a real page lookup: found → 200, missing → notFound().
const KNOWN_PAGE_HANDLES = new Set([
  "about", "about-us", "our-story", "story",
  "contact", "contact-us",
  "shipping", "shipping-policy", "delivery", "delivery-policy",
  "returns", "returns-policy", "refund-policy", "refunds", "exchanges",
  "faq", "faqs",
  "track", "track-order", "order-tracking",
  "terms", "terms-of-service", "terms-and-conditions", "terms-conditions",
  "privacy", "privacy-policy",
  "size-guide", "sizing", "size-chart",
  "lookbook",
  "stores", "locations", "store-locator", "our-stores",
  "wholesale",
  "careers",
  "gift-cards", "gift-card",
  "testimonial", "testimonials", "reviews",
  "blogs", "blog", "news", "journal",
  "pages",
  // Account + post-purchase pages a theme templates (bazar ships profile +
  // order-confirmation) and links to from chrome — without these they fall to
  // notFound() and the customer/merchant sees the themed 404.
  "profile", "account",
  "order-confirmation", "order-confirmed", "thank-you", "thanks",
]);

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

  // Soft-404 guard: only known content-page handles render a themed
  // placeholder page (HTTP 200). Everything else is genuinely missing →
  // notFound() renders the theme's 404 template with a real HTTP 404 status
  // (and is excluded from indexing by the 404), instead of a 200 placeholder.
  const topHandle = (slug?.[0] ?? "").toLowerCase();
  if (!KNOWN_PAGE_HANDLES.has(topHandle)) {
    notFound();
  }

  // Map well-known content handles onto a theme template TYPE so a theme that
  // ships a dedicated About / Contact template (e.g. bazar's bz-about-section /
  // bz-contact) renders it instead of the generic `page` body. Unmapped handles
  // stay `page`; a theme without the mapped template still degrades to the
  // routeFallback below, so this is additive and never blanks a page.
  const TEMPLATE_TYPE_BY_HANDLE: Record<string, string> = {
    about: "about",
    "about-us": "about",
    "our-story": "about",
    story: "about",
    contact: "contact",
    "contact-us": "contact",
    // Account → the theme's `profile` template; post-purchase → its
    // `order-confirmation` template. Themes without these still degrade to the
    // routeFallback, so this is additive.
    profile: "profile",
    account: "profile",
    "order-confirmation": "order-confirmation",
    "order-confirmed": "order-confirmation",
    "thank-you": "order-confirmation",
    thanks: "order-confirmation",
  };
  const pageType = TEMPLATE_TYPE_BY_HANDLE[topHandle] ?? "page";

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

  const ar = ((store as { default_language?: string })?.default_language || "")
    .toLowerCase()
    .startsWith("ar");
  const emptyMessage = ar
    ? "الصفحة دي لسه مفيهاش محتوى. ارجع للرئيسية لحد ما المحتوى يتنشر."
    : "This page doesn't have any content yet. Head back home while it's being prepared.";
  const numuPlaceholder = (
    <NumuDefaultShell
      ar={ar}
      fullScreen={false}
      eyebrow={(store as { name?: string })?.name || "NUMU"}
      title={humanize(handle)}
      message={emptyMessage}
      action={{ href: "/", label: ar ? "الرئيسية" : "Back home" }}
    />
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
          type: pageType,
          title: humanize(handle),
          handle,
          // body absent until the CMS-pages backend lands; themes render
          // a graceful placeholder when page.data.page.body is null.
          data: { page: { handle, title: humanize(handle), body: null } },
        }}
        // ENG-2: themes with no `page` template render these nav paths blank —
        // show the branded NUMU placeholder (same as the built-in branch
        // below) so e.g. /about is never a blank screen.
        routeFallback={numuPlaceholder}
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

  return numuPlaceholder;
}
