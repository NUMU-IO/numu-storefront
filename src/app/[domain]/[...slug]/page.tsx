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
 *   - Resolve store + theme, and the published CMS record for the handle when
 *     the merchant authored one.
 *   - For BYOT themes: hand the bundle `page.type = "page"` with the CMS
 *     title/body (or the humanized handle) so it renders its `page` template
 *     (header + content + footer) instead of a 404.
 *   - For built-in themes: render the `page` template.
 *
 * Genuinely-missing RESOURCES (a bad product/collection id) still 404 via
 * their own route's notFound() → the theme's styled `404` template. This
 * catch-all only absorbs open-ended CONTENT/nav paths so they render a
 * coherent themed page rather than a dead end.
 */
import {
  fetchStoreByDomain,
  fetchThemeSettings,
  fetchStorePage,
} from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { sanitizeHtml } from "@/lib/sanitize-html";
import {
  KNOWN_PAGE_HANDLES,
  TEMPLATE_TYPE_BY_HANDLE,
  catchAllOwnsHandle,
} from "@/lib/content-pages";
import {
  alternatesFor,
  storeRobots,
  type StoreForSeo,
} from "@/lib/seo";
import { PageTemplateRenderer } from "@/components/theme-engine/PageTemplateRenderer";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import { NumuDefaultShell } from "@/components/storefront/NumuDefaultShell";
import { notFound } from "next/navigation";
import type { ThemeSettingsV3 } from "@/types";
import type { Metadata } from "next";

// Open param set (can't generateStaticParams). Render on demand but CACHE
// per-path so a crawler walking random URLs can't force unbounded uncached
// SSR; identical paths reuse the cached render.
export const revalidate = 300;

interface PageProps {
  params: Promise<{ domain: string; slug: string[] }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function humanize(handle: string): string {
  return handle
    .split("/")
    .pop()!
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Pick a bilingual value for a language, mirroring `pages/[handle]`. */
function pick(map: Record<string, string> | undefined, lang: string): string {
  if (!map) return "";
  return map[lang] || map.en || map.ar || Object.values(map)[0] || "";
}

/** The store's own language — the one the un-prefixed URL serves. */
function storeLang(store: unknown): string {
  return (store as { default_language?: string } | null)?.default_language || "en";
}

/**
 * Resolve the theme for the handle's indexing decision. Best-effort: a store
 * with no installed theme (or a fetch blip) must not turn the whole metadata
 * call into the catch branch and lose the page title.
 */
async function loadThemeSettings(
  storeId: string,
): Promise<ThemeSettingsV3 | null> {
  const raw = await fetchThemeSettings(storeId).catch(() => null);
  if (!raw) return null;
  return resolveThemeSettings(raw?.theme_settings || raw || {});
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain, slug } = await params;
  const handle = (slug ?? []).join("/");
  const topHandle = (slug?.[0] ?? "").toLowerCase();
  // A handle backed by neither a theme template nor a published CMS record
  // renders the synthesized placeholder below — a body-less page that must
  // never enter the index. `follow` stays on so its themed chrome still passes
  // link equity through. Deliberately paired with NO canonical: a noindex page
  // that also names another URL as its original hands Google two contradictory
  // instructions about the same document, and it resolves them by ignoring one.
  const placeholderRobots: Metadata["robots"] = { index: false, follow: true };

  // Mirror the render guards below before claiming anything about this URL.
  // A path this route answers 404 for (handle outside the allowlist, or a
  // crafted over-long one) must never advertise itself as indexable — a
  // merchant's published CMS page sitting at an UNROUTED handle would otherwise
  // put `index, follow` plus a canonical on a page that 404s. Multi-segment
  // paths are excluded for the same reason: `/about/team` renders the very same
  // about template as `/about`, so indexing it mints duplicates of a page that
  // already has its own canonical URL. Returning early also spares the three
  // API round trips on every garbage URL a crawler walks.
  if (
    (slug?.length ?? 0) !== 1 ||
    handle.length > 120 ||
    !KNOWN_PAGE_HANDLES.has(topHandle)
  ) {
    return { title: humanize(handle), robots: placeholderRobots };
  }

  try {
    const store = await fetchStoreByDomain(domain);
    const storeForSeo = store as unknown as StoreForSeo;
    const lang = storeLang(store);
    // Both reads are React-cache()d, so the page render below shares these
    // round trips rather than repeating them.
    const [themeSettings, cmsPage] = await Promise.all([
      loadThemeSettings(store.id),
      fetchStorePage(store.id, handle),
    ]);
    const title = pick(cmsPage?.title, lang) || humanize(handle);

    // `/{handle}` vs `/pages/{handle}`: the same content at two indexable URLs.
    // THIS one is the original — it renders the theme's designed template and
    // is what the theme's own nav links to, while `/pages/{handle}` is the
    // plainer CMS fallback that canonicalises here (both read the same
    // predicate, so they can never both claim to be the original). Once real
    // content backs the handle the page indexes and self-canonicalises; the
    // store-level gate still wins for a suspended or opted-out store via
    // storeRobots.
    const hasCmsBody = pick(cmsPage?.body, lang).trim().length > 0;
    if (catchAllOwnsHandle(topHandle, themeSettings, hasCmsBody)) {
      return {
        title,
        alternates: alternatesFor(storeForSeo, domain, `/${handle}`),
        robots: storeRobots(storeForSeo),
      };
    }
    return { title, robots: placeholderRobots };
  } catch {
    return { title: humanize(handle), robots: placeholderRobots };
  }
}

export default async function CatchAllPage({ params, searchParams }: PageProps) {
  const { domain, slug } = await params;
  const handle = (slug ?? []).join("/");

  // The order-confirmation / track templates need the order id from the query
  // (?order_id=…, set by the payment redirect). Without it the theme's
  // useOrder() falls back to the page handle and shows "order not found".
  const sp = (await searchParams) ?? {};
  const orderId = typeof sp.order_id === "string" ? sp.order_id : undefined;

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

  // Well-known content handles map onto a dedicated theme template TYPE (see
  // content-pages.ts, shared with generateMetadata's canonical decision so the
  // two can't drift). Unmapped handles stay `page`; a theme without the mapped
  // template still degrades to the routeFallback below, so this is additive and
  // never blanks a page.
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

  // The published CMS record behind this handle, when the merchant authored one
  // (`/about` and `/pages/about` are the SAME page — this route is just the one
  // the theme's nav links to). generateMetadata marks the URL indexable once a
  // record with a body backs it, so the render has to carry that body: without
  // it the page would advertise `index, follow` while painting the body-less
  // placeholder — an indexable soft-404. React-cache()d, so metadata and this
  // render share one round trip.
  const cmsPage = await fetchStorePage(store.id, handle);
  const lang = storeLang(store);
  const resolvedTitle = pick(cmsPage?.title, lang) || humanize(handle);
  const resolvedBody = pick(cmsPage?.body, lang) || null;
  // Merchant-authored HTML → sanitize before any dangerouslySetInnerHTML.
  const safeBody = resolvedBody ? sanitizeHtml(resolvedBody) : null;

  const ar = ((store as { default_language?: string })?.default_language || "")
    .toLowerCase()
    .startsWith("ar");
  const emptyMessage = ar
    ? "الصفحة دي لسه مفيهاش محتوى. ارجع للرئيسية لحد ما المحتوى يتنشر."
    : "This page doesn't have any content yet. Head back home while it's being prepared.";
  // Fallback for a theme that ships no template for `pageType`: the real CMS
  // title + body when one exists (same markup as `pages/[handle]`), else the
  // branded NUMU "nothing here yet" shell.
  const routeFallback = safeBody ? (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold">{resolvedTitle}</h1>
      <div
        className="prose mt-4 max-w-none"
        dangerouslySetInnerHTML={{ __html: safeBody }}
      />
    </div>
  ) : (
    <NumuDefaultShell
      ar={ar}
      fullScreen={false}
      eyebrow={(store as { name?: string })?.name || "NUMU"}
      title={resolvedTitle}
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
        bundleChecksum={themeSettings.external_theme.checksum}
        cssUrl={themeSettings.external_theme.css_url}
        themeSettings={themeSettings}
        storeData={store}
        page={{
          type: pageType,
          title: resolvedTitle,
          handle,
          // The real CMS record when one is published for this handle; body
          // stays null otherwise and themes render their graceful placeholder.
          data: {
            page: {
              handle,
              title: resolvedTitle,
              body: resolvedBody,
              title_i18n: cmsPage?.title ?? null,
              body_i18n: cmsPage?.body ?? null,
              seo: cmsPage?.seo ?? null,
            },
            // Surfaced for the order-confirmation/track templates' useOrder().
            ...(orderId ? { order_id: orderId } : {}),
          },
        }}
        // ENG-2: themes with no `page` template render these nav paths blank —
        // show the CMS body or the branded NUMU placeholder (same as the
        // built-in branch below) so e.g. /about is never a blank screen.
        routeFallback={routeFallback}
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

  return routeFallback;
}
