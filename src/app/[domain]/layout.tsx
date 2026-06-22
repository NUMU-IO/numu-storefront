import {
  fetchStoreByDomain,
  fetchThemeSettings,
  fetchStoreMenus,
} from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { SectionGroupRenderer } from "@/components/theme-engine/SectionGroupRenderer";
import { ThemeDataProvider } from "@/components/layout/ThemeDataProvider";
import { AttributionProvider } from "@/components/layout/AttributionProvider";
import { CustomerBridgeProvider } from "@/components/layout/CustomerBridgeProvider";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import { PreviewBridge } from "@/components/theme-engine/PreviewBridge";
import { PreviewNavigationBridge } from "@/components/theme-engine/PreviewNavigationBridge";
import { MetaPixel } from "@/components/tracking/MetaPixel";
import { resolveMetaPixelIds } from "@/lib/meta-pixel";
import { getActivePromotions } from "@/lib/promo-server";
import { resolveBrandTokens } from "@/lib/brand-tokens";
import { AnnouncementBar } from "@/components/promo/AnnouncementBar";
import { PromoMounts } from "@/components/promo/PromoMounts";
import {
  canonicalOriginFor,
  storeRobots,
  storeSeoTitle,
  storeSeoDescription,
  storeSocialImage,
  buildOpenGraph,
  buildTwitter,
  NOINDEX_ROBOTS,
  type StoreForSeo,
} from "@/lib/seo";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  UNLOCK_COOKIE,
  isUnlocked,
  readPasswordProtection,
} from "@/lib/store-lock";
import type { Metadata } from "next";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ domain: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ domain: string }> }): Promise<Metadata> {
  const { domain } = await params;
  try {
    const store = (await fetchStoreByDomain(domain)) as unknown as StoreForSeo | null;
    if (!store) return { title: "NUMU Store", robots: NOINDEX_ROBOTS };

    const origin = canonicalOriginFor(store, domain);
    const base = origin.endsWith("/") ? origin : `${origin}/`;
    const title = storeSeoTitle(store);
    const description = storeSeoDescription(store);
    const image = storeSocialImage(store);

    // Site-verification + favicon — surfaced when configured.
    const other: Record<string, string> = {};
    const g = (store.seo?.google_site_verification ?? "").trim();
    const b = (store.seo?.bing_site_verification ?? "").trim();
    const fb = (
      store.settings as unknown as
        | { tracking?: { meta?: { domain_verification_token?: string | null } } }
        | undefined
    )?.tracking?.meta?.domain_verification_token?.trim();
    if (g) other["google-site-verification"] = g;
    if (b) other["msvalidate.01"] = b;
    if (fb) other["facebook-domain-verification"] = fb;
    // Theme customizer's identity.favicon_url wins; fall back to the favicon
    // set in the hub's Online Store → Preferences (`settings.favicon_url`) so
    // a merchant who uploads it there sees it without opening the editor;
    // finally fall back to a V3 theme's Brand → Favicon global setting
    // (`theme_settings.global_settings.favicon`) so a BYOT theme that exposes
    // its own favicon picker is honoured too.
    const ts = store.theme_settings as unknown as
      | {
          identity?: { favicon_url?: string };
          global_settings?: { favicon?: string };
        }
      | undefined;
    const favicon =
      ts?.identity?.favicon_url ||
      (store.settings as unknown as { favicon_url?: string } | undefined)
        ?.favicon_url ||
      ts?.global_settings?.favicon;

    return {
      metadataBase: new URL(base),
      title: { default: title, template: `%s · ${store.name ?? title}` },
      description,
      applicationName: store.name ?? undefined,
      alternates: { canonical: base },
      openGraph: buildOpenGraph(store, { title, description, url: base, image }),
      twitter: buildTwitter({ title, description, image }),
      robots: storeRobots(store),
      ...(favicon ? { icons: { icon: favicon, shortcut: favicon } } : {}),
      ...(Object.keys(other).length ? { other } : {}),
    };
  } catch {
    return { title: "NUMU Store", robots: NOINDEX_ROBOTS };
  }
}

export default async function StoreLayout({ children, params }: LayoutProps) {
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

  // Pre-launch password gate. The merchant flips
  // `store.settings.password_protected.enabled` from the hub. Until
  // the visitor proves the password (cookie hash matches the stored
  // hash), every route renders the unlock form.
  //
  // Exemptions:
  //   - The /password route itself (otherwise infinite redirect).
  //   - The /api/* routes are served at the app root by Next, so they
  //     never go through this layout — the API proxies remain reachable
  //     for the unlock POST and any backend-only checks.
  const protection = readPasswordProtection(store);
  if (protection?.enabled) {
    const cookieStore = await cookies();
    const headerList = await headers();
    const path = headerList.get("x-numu-pathname") || "";
    // x-numu-pathname is the rewritten path: `/<domain>/<rest>`. Strip
    // the leading domain so we can check just the visitor-facing route.
    const visitorPath = path.startsWith(`/${domain}`)
      ? path.slice(`/${domain}`.length) || "/"
      : path || "/";
    const onPasswordRoute =
      visitorPath === "/password" || visitorPath.startsWith("/password/");
    if (!onPasswordRoute) {
      const unlockCookie = cookieStore.get(UNLOCK_COOKIE)?.value;
      if (!isUnlocked(unlockCookie, protection.password_hash)) {
        const next = encodeURIComponent(visitorPath || "/");
        redirect(`/password?next=${next}`);
      }
    }
  }

  // Stamp `numu_active_store` so the proxy.ts middleware can rebase
  // apex paths under `<domain>/...` even when Referer is missing
  // (deep-link landings, cross-origin Referers, privacy browsers).
  // Server-side cookie set is best-effort: throws when the response is
  // already streamed (Edge runtime restriction). Failure is non-fatal —
  // the next page load will set it.
  try {
    const cookieStore = await cookies();
    if (cookieStore.get("numu_active_store")?.value !== domain) {
      cookieStore.set("numu_active_store", domain, {
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30d — refreshes on every visit anyway
        sameSite: "lax",
      });
    }
  } catch {
    /* ignore — cookies are advisory routing hints, not auth */
  }

  let themeRaw;
  try {
    themeRaw = await fetchThemeSettings(store.id);
  } catch {
    // Store exists but no active theme installation. Distinct from
    // "store not found" — the merchant has a store, they just haven't
    // picked a theme yet (or ran into the V3 install gap).
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2 text-center px-6">
        <h1 className="text-xl font-semibold">{store.name || "Store"}</h1>
        <p className="text-gray-500">
          No theme is installed on this store yet. Open the merchant hub →
          Online Store → Themes to install one.
        </p>
      </div>
    );
  }

  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});
  const isByot = !!themeSettings.external_theme?.bundle_url && !isBuiltInTheme(themeSettings.theme_id);

  // Phase 2.4 — store navigation menus, fetched once here and shared with
  // every page's BYOT bundle via ThemeDataProvider → ByotThemeBoundary
  // (header/footer render on every route, so this can't live per-page).
  // Best-effort: a failure leaves the bundle on its DEFAULT_NAV fallback.
  const navigation = await fetchStoreMenus(store.id).catch(() => ({}));

  // ENG-3 R1 — the proxy resolves the visitor locale (URL prefix › ?locale ›
  // cookie › store default) and stamps it on `x-numu-locale`. Forward it through
  // ThemeDataProvider so ByotThemeBoundary can inject it into the bundle mount
  // ctx; otherwise a bundle only sees the locale via the (later, client-side)
  // numu_locale cookie and an explicit ?locale=ar override can render the wrong
  // language while the host <html dir> already flipped.
  const localeHeaders = await headers();
  const visitorLocale = localeHeaders.get("x-numu-locale") || undefined;

  // Meta Pixel — fires for built-in AND BYOT themes since the host shell wraps
  // every page. Only mounted when the merchant configured an enabled pixel;
  // the browser Pixel also sets `_fbp`/`_fbc` for CAPI match quality.
  const metaPixelIds = resolveMetaPixelIds(store);

  // Promotions — server-driven announcement bar (offers-v2), rendered in the
  // shell so it shows for built-in + BYOT alike. Best-effort: null when the
  // `ff_storefront_promo_render` flag is off or none are active.
  const promotions = await getActivePromotions(store.id, {
    locale: visitorLocale === "ar" ? "ar" : "en",
  }).catch(() => null);
  const announcementBar = promotions?.announcement_bars?.[0] ?? null;

  // Brand tokens for host-rendered overlays (cookie banner) so they adopt the
  // store's palette (bazar → cream/ink/amber) instead of a hardcoded white bar.
  const brandVars = resolveBrandTokens(
    themeSettings.global_settings as Record<string, unknown> | undefined,
  );

  return (
    <ThemeDataProvider
      themeSettings={themeSettings}
      storeData={store}
      navigation={navigation}
      locale={visitorLocale}
    >
      {/* Path-segment routing in dev: when the storefront is reached at
          `/<subdomain>/...` (rather than `<subdomain>.numueg.app`),
          relative anchors like `/collections/all` would otherwise hit
          the apex 404. `<base>` rebases all relative links against the
          subdomain prefix. Hoisted into <head> by Next.js automatically.
          Production (subdomain hosting) doesn't need this. */}
      <base href={`/${domain}/`} />
      {metaPixelIds.length > 0 && <MetaPixel pixelIds={metaPixelIds} />}
      {/* Phase 5.7 WCAG-AA — skip-to-content link.
          Keyboard users tab through the header before reaching the
          page body; a skip link lets them jump straight to main
          content. Hidden by default; reveals on focus. The href
          targets `#main` — every page wraps its primary content in
          <main id="main"> via the BYOT contract or via the built-in
          PageTemplateRenderer (also in this PR). */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-black focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      >
        Skip to content
      </a>
      {/* Feature 001 — captures numu_attribution cookie on first mount
          and exposes window.__numu_attribution bridge for BYOT themes. */}
      <AttributionProvider>
      {/* Sibling bridge for the authenticated customer's ID. Lets the
          SDK include customer_id on funnel events without re-fetching
          /api/customer/me on every track call. Anonymous sessions
          leave the bridge returning null. */}
      <CustomerBridgeProvider>
        {/* Preview bridge — only active when ?preview=true&editor=v3.
            Listens for postMessage updates from the dashboard editor. */}
        <PreviewBridge />
        {/* Turns editor page switches into client-side route changes inside
            the preview iframe (no full reload). Inert outside preview mode. */}
        <PreviewNavigationBridge />
        {announcementBar && (
          <AnnouncementBar
            promotion={announcementBar}
            locale={visitorLocale === "ar" ? "ar" : "en"}
          />
        )}
        {promotions && (
          <PromoMounts
            popups={promotions.popups || []}
            floatingWidgets={promotions.floating_widgets || []}
            cookieBanner={promotions.cookie_banner ?? null}
            locale={visitorLocale === "ar" ? "ar" : "en"}
            brandVars={brandVars}
          />
        )}
        {!isByot && themeSettings.section_groups?.header && (
          <SectionGroupRenderer
            group={themeSettings.section_groups.header}
            themeId={themeSettings.theme_id}
            storeData={store}
          />
        )}
        {/* Skip-link target. BYOT bundles that render their own <main>
            win over this wrapper because the link's `#main` selector
            finds the FIRST element with that id; bundles render after
            this point, but a bundle without an id="main" falls back to
            this anchor. */}
        <div id="main">{children}</div>
        {!isByot && themeSettings.section_groups?.footer && (
          <SectionGroupRenderer
            group={themeSettings.section_groups.footer}
            themeId={themeSettings.theme_id}
            storeData={store}
          />
        )}
      </CustomerBridgeProvider>
      </AttributionProvider>
    </ThemeDataProvider>
  );
}
