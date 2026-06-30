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
import type { ThemeSettingsV3 } from "@/types";

interface PageProps {
  params: Promise<{ domain: string }>;
}

// ── Hero LCP preload (best-effort) ──────────────────────────────────────────
// Read the first home-template section's image server-side and emit a
// width-only <link rel=preload as=image fetchpriority=high> for the DESKTOP
// hero. The width ladder + sizes MUST match HeroMedia's desktop <img> — which
// is width-only since the §7 prereq — so the preloaded bytes are exactly the
// resource the <img> requests (otherwise the browser fetches it twice). Mobile
// is intentionally NOT preloaded. Best-effort: empty/sanitized/marketplace
// templates → nothing emitted; never throws.
const HERO_IMAGE_KEYS = [
  "hero_image_url",
  "hero_image",
  "background_image",
  "image_url",
  "image",
] as const;
// MUST equal HeroMedia's HERO_WIDTHS (+ sizes="100vw") so the preload is
// CREDITED at every viewport: a narrower subset lets the browser pick a
// candidate (e.g. 768w at ~768px/DPR1) not in the preload set, leaving the
// <link> "unused" and double-fetching the hero. Desktop-only by design (the
// mobile LCP is usually the headline; the <picture> mobile <source> serves it).
const PRELOAD_WIDTHS_DESKTOP = [640, 768, 1024, 1280, 1920];

function readImageUrl(v: unknown): string | null {
  if (typeof v === "string") return v || null;
  if (v && typeof v === "object" && "url" in v) {
    const u = (v as { url?: unknown }).url;
    return typeof u === "string" && u ? u : null;
  }
  return null;
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
        return { desktop: u, mobile: readImageUrl(s["hero_image_mobile"]) };
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
  const themeRaw = await fetchThemeSettings(store.id);
  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});

  // Phase 4.6 — Organization + WebSite JSON-LD on the home page.
  // Both are recommended by Google's rich-results guidelines:
  //   - Organization powers the Knowledge Graph card
  //   - WebSite + SearchAction enables the sitelinks search box
  const platformDomain = process.env.NUMU_PLATFORM_DOMAIN || "numueg.app";
  const isProd = process.env.NEXT_PUBLIC_NUMU_ENV === "production";
  const baseUrl = isProd
    ? `https://${(store as { custom_domain?: string }).custom_domain || `${domain}.${platformDomain}`}`
    : `http://localhost:3000/${domain}`;
  const organizationLd = buildOrganizationLd({
    baseUrl,
    storeName: store.name || domain,
    logoUrl: (store as { logo_url?: string }).logo_url ?? null,
    description: (store as { description?: string }).description ?? null,
    socialLinks:
      (store as { social_links?: Record<string, string> }).social_links ?? null,
  });
  const websiteLd = buildWebsiteLd({
    baseUrl,
    storeName: store.name || domain,
  });
  // Best-effort hero preload — desktop-only, media-scoped so it never fires on
  // mobile when an art-directed mobile image is in play. Folded into ldScripts
  // so both the BYOT and built-in returns hoist it to <head>.
  const heroLcp = extractHero(themeSettings);
  const heroPreload = heroLcp.desktop ? (
    <link
      rel="preload"
      as="image"
      href={imgTransformUrl(heroLcp.desktop, 1920)}
      imageSrcSet={preloadSrcSet(heroLcp.desktop, PRELOAD_WIDTHS_DESKTOP)}
      imageSizes="100vw"
      fetchPriority="high"
      media={heroLcp.mobile ? "(min-width: 768px)" : undefined}
    />
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
    const [products, collections] = await Promise.all([
      fetchProducts(store.id, 20).catch(() => []),
      fetchCollections(store.id).catch(() => []),
    ]);
    return (
      <>
        {ldScripts}
        <ByotThemeBoundary
          bundleUrl={themeSettings.external_theme.bundle_url}
          cssUrl={themeSettings.external_theme.css_url}
          themeSettings={themeSettings}
          storeData={store}
          page={{
            type: "home",
            title: store.name,
            data: { products, collections },
          }}
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
