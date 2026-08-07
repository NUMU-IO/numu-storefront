import { fetchStoreByDomain, fetchThemeSettings, fetchProducts, fetchCollections } from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { PageTemplateRenderer } from "@/components/theme-engine/PageTemplateRenderer";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import {
  buildOrganizationLd,
  buildWebsiteLd,
  serializeLd,
} from "@/lib/json-ld";
import { canonicalOriginFor, type StoreForSeo } from "@/lib/seo";
import { SsrHomeContent } from "@/components/seo/SsrContentLayer";
import { resolveThemeSsrHtml } from "@/lib/ssr-theme-request";
import { headers } from "next/headers";
import type { ThemeSettingsV3 } from "@/types";

interface PageProps {
  params: Promise<{ domain: string }>;
}

// ── Hero LCP preload (best-effort) ──────────────────────────────────────────
// Read the first home-template section's image server-side and emit a
// width-only <link rel=preload as=image fetchpriority=high> per art-direction
// branch. The width ladder + sizes MUST match HeroMedia's <img> — which is
// width-only (see focalSrc's crop gate) — so the preloaded bytes are exactly
// the resource the <img> requests (otherwise the browser fetches it twice).
// Best-effort: empty/sanitized/marketplace templates → nothing emitted; never
// throws.
const HERO_IMAGE_KEYS = [
  "hero_image_url",
  "hero_image",
  "background_image",
  "image_url",
  "image",
  "slide_1_image", // vionne-style slideshow hero (first slide is the LCP)
  "image_1", // empire-style slideshow hero
] as const;
// MUST equal HeroMedia's HERO_WIDTHS (+ sizes="100vw") so the preload is
// CREDITED at every viewport: a narrower subset lets the browser pick a
// candidate (e.g. 768w at ~768px/DPR1) not in the preload set, leaving the
// <link> "unused" and double-fetching the hero.
const PRELOAD_WIDTHS = [640, 768, 1024, 1280, 1920];
// HeroMedia's DESKTOP_BASE_WIDTH / MOBILE_BASE_WIDTH — the width it puts on the
// bare `src`. Only used for the <link href>, which is the no-srcset fallback.
const BASE_WIDTH_DESKTOP = 1920;
const BASE_WIDTH_MOBILE = 1280;
// HeroMedia's DEFAULT_BREAKPOINT. Its mobile bitmap is chosen by
// `matchMedia("(max-width: 767px)")`, so these two media queries partition the
// viewport exactly the way the component does.
const MEDIA_DESKTOP = "(min-width: 768px)";
const MEDIA_MOBILE = "(max-width: 767px)";

function readImageUrl(v: unknown): string | null {
  if (typeof v === "string") return v || null;
  if (v && typeof v === "object" && "url" in v) {
    const u = (v as { url?: unknown }).url;
    return typeof u === "string" && u ? u : null;
  }
  return null;
}

/**
 * The mobile art-direction bitmap for the hero setting `key`, or null when the
 * theme will render the DESKTOP image on phones too.
 *
 * Every V3 hero follows one convention: the mobile image lives at
 * `<key>_mobile` and is used only when the section's `use_mobile_image` toggle
 * is on. This function has to agree with the theme, because the two preloads
 * below partition the viewport between them — guess wrong and the phone
 * preloads a bitmap the theme never requests while the one it does request
 * arrives with no hint at all.
 *
 * Reading `hero_image_mobile` alone (the previous behaviour) only ever matched
 * the single-image heroes. Slideshow heroes name theirs `slide_1_image_mobile`
 * (vionne) and `image_1_mobile` (empire), so those stores resolved to null →
 * the desktop `<link>` lost its `media` guard and phones downloaded the desktop
 * hero at fetchpriority=high and threw it away, while the real mobile hero went
 * undiscovered until the theme hydrated 6.9 s later. That was the bulk of
 * vionne's 18.7 s mobile LCP.
 *
 * `=== true` mirrors what 12 of the 13 V3 heroes do. gilded-glamour defaults
 * the toggle ON (`!== false`); an unset toggle there means we skip the mobile
 * preload and leave the desktop one ungated — i.e. exactly today's behaviour,
 * never worse.
 */
function readMobileHero(
  s: Record<string, unknown>,
  key: string,
): string | null {
  if (s["use_mobile_image"] !== true) return null;
  return readImageUrl(s[`${key}_mobile`]) ?? readImageUrl(s["hero_image_mobile"]);
}

function extractHero(themeSettings: ThemeSettingsV3): {
  desktop: string | null;
  mobile: string | null;
} {
  const home = themeSettings.templates?.home;
  const order = home?.order ?? [];
  const sections = home?.sections ?? {};
  // Scan sections in render order for the first one carrying a hero image —
  // NOT just order[0]: header-first themes (gilded, luxury-minimal, …) put the
  // editable header at order[0] and the hero second, so order[0]-only would
  // miss the hero and emit no preload.
  for (const id of order) {
    const s = (sections[id]?.settings ?? {}) as Record<string, unknown>;
    for (const k of HERO_IMAGE_KEYS) {
      const u = readImageUrl(s[k]);
      if (u) {
        return { desktop: u, mobile: readMobileHero(s, k) };
      }
    }
  }
  return { desktop: null, mobile: null };
}

// Inlined width-only image-transform URL builder. Byte-matches the SDK's
// focalSrc(url, { width }) output (identical URLSearchParams construction) so
// the preloaded resource === HeroMedia's desktop request. Inlined rather than
// imported because the `@numueg/theme-sdk` barrel pulls React-context code that
// fails server-side evaluation when imported into this Server Component.
function imgTransformUrl(url: string, width: number): string {
  if (!url || url.startsWith("data:") || /[?&](fp-x|fp-y)=/.test(url)) return url;
  const p = new URLSearchParams();
  p.set("url", url);
  p.set("w", String(Math.round(width)));
  return `/api/image-transform?${p.toString()}`;
}

const preloadSrcSet = (url: string, ws: number[]) =>
  ws.map((w) => `${imgTransformUrl(url, w)} ${w}w`).join(", ");

/**
 * Phase 4.7 — ISR cache: revalidate every 60s.
 *
 * The home page is the highest-traffic surface and the slowest to
 * regenerate (store + theme + products + collections roundtrips).
 * 60-second ISR + revalidation tags from the API client
 * (`store-${id}`, `theme-${id}`) means a publish from the merchant hub
 * triggers regeneration without a stale window past one minute.
 */
export const revalidate = 60;

export default async function HomePage({ params }: PageProps) {
  const { domain } = await params;

  const store = await fetchStoreByDomain(domain);
  // theme + a starter set of products/collections all key off store.id and are
  // independent — fetch them in ONE parallel wave after the store resolves
  // (was: theme serially, THEN products/collections). products/collections feed
  // the BYOT home grids; on the rare built-in path they go unused (cheap,
  // best-effort — never blocks the render).
  const [themeRaw, products, collections] = await Promise.all([
    fetchThemeSettings(store.id),
    // 300 (was 20) so home sections pinning products by id (featured rows)
    // can reference any item in the catalog — pins outside the fetched window
    // silently drop and the whole row hides.
    fetchProducts(store.id, 300).catch(() => []),
    fetchCollections(store.id).catch(() => []),
  ]);
  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});

  // Phase 4.6 — Organization + WebSite JSON-LD on the home page.
  // Both are recommended by Google's rich-results guidelines:
  //   - Organization powers the Knowledge Graph card
  //   - WebSite + SearchAction enables the sitelinks search box
  //
  // Origin via canonicalOriginFor, not a local copy of the same conditional:
  // the local copy trusted `custom_domain` with no status check (so an
  // unverified hostname leaked into the store's own entity `@id` and url) and
  // pointed at the wrong dev port.
  const storeForSeo = store as unknown as StoreForSeo;
  const baseUrl = canonicalOriginFor(storeForSeo, domain);
  const organizationLd = buildOrganizationLd({
    baseUrl,
    storeName: store.name || domain,
    logoUrl: (store as { logo_url?: string }).logo_url ?? null,
    description: (store as { description?: string }).description ?? null,
    socialLinks:
      (store as { social_links?: Record<string, string> }).social_links ?? null,
    // Merchant-declared Schema.org subtype ("ClothingStore", …) so the
    // homepage says what kind of retailer this is instead of "some
    // organization" — the classification signal crawlers actually read.
    businessType: storeForSeo.seo?.business_type ?? null,
  });
  const websiteLd = buildWebsiteLd({
    baseUrl,
    storeName: store.name || domain,
  });
  // Best-effort hero preload, one <link> per art-direction branch. When the
  // theme swaps bitmaps on phones the two are media-scoped so each viewport
  // fetches exactly one; when it doesn't, the desktop link runs ungated and
  // serves both. Folded into ldScripts so the BYOT and built-in returns both
  // hoist them to <head>.
  const heroLcp = extractHero(themeSettings);
  const heroPreload = heroLcp.desktop ? (
    <>
      <link
        rel="preload"
        as="image"
        href={imgTransformUrl(heroLcp.desktop, BASE_WIDTH_DESKTOP)}
        imageSrcSet={preloadSrcSet(heroLcp.desktop, PRELOAD_WIDTHS)}
        imageSizes="100vw"
        fetchPriority="high"
        media={heroLcp.mobile ? MEDIA_DESKTOP : undefined}
      />
      {heroLcp.mobile && (
        <link
          rel="preload"
          as="image"
          href={imgTransformUrl(heroLcp.mobile, BASE_WIDTH_MOBILE)}
          imageSrcSet={preloadSrcSet(heroLcp.mobile, PRELOAD_WIDTHS)}
          imageSizes="100vw"
          fetchPriority="high"
          media={MEDIA_MOBILE}
        />
      )}
    </>
  ) : null;
  const ldScripts = (
    <>
      {heroPreload}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeLd(organizationLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeLd(websiteLd) }}
      />
    </>
  );

  // BYOT: render client-side. Fetch a starter set of products + collections
  // so the bundle's home grids and category cards have real data to render
  // links against. Failures are non-fatal — the bundle's own sections
  // gracefully empty out.
  if (themeSettings.external_theme?.bundle_url && !isBuiltInTheme(themeSettings.theme_id)) {
    // ADR-7 — locale for the crawler-facing content layer (see the PDP route).
    const hl = await headers();
    const ssrLocale =
      hl.get("x-numu-locale") ||
      (store as { default_language?: string })?.default_language ||
      "en";
    // ONE page descriptor for both render paths — the server render and the
    // client mount must receive the identical object or hydration mismatches.
    const pageCtx = {
      type: "home" as const,
      title: store.name,
      data: { products, collections },
    };
    // Isolated theme SSR (dark unless NUMU_SSR_THEME=1). null → today's
    // behavior: skeleton + client mount, with the content layer for crawlers.
    const ssrHtml = await resolveThemeSsrHtml({
      themeSettings,
      store,
      page: pageCtx,
    });
    return (
      <>
        {ldScripts}
        <ByotThemeBoundary
          bundleUrl={themeSettings.external_theme.bundle_url}
          bundleChecksum={themeSettings.external_theme.checksum}
          cssUrl={themeSettings.external_theme.css_url}
          themeSettings={themeSettings}
          storeData={store}
          page={pageCtx}
          ssrHtml={ssrHtml}
          // ADR-7 — store name/description + collection and product links in
          // the initial HTML. Dropped on hydration, before the theme paints.
          seoContent={
            <SsrHomeContent
              storeName={store?.name}
              storeDescription={(store as { description?: string })?.description}
              collections={collections}
              products={products}
              storeCurrency={store?.currency}
              locale={ssrLocale}
            />
          }
        />
      </>
    );
  }

  // Built-in: render server-side
  const homeTemplate = themeSettings.templates?.home;
  if (!homeTemplate) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">No home template configured</div>;
  }

  return (
    <>
      {ldScripts}
      <PageTemplateRenderer
        template={homeTemplate}
        themeId={themeSettings.theme_id}
        storeData={store}
      />
    </>
  );
}
