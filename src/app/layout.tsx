import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { fetchStoreByDomain, fetchThemeSettings } from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import { RuntimeImportMap } from "@/components/theme-engine/RuntimeImportMap";

export const metadata: Metadata = {
  title: "NUMU Store",
  description: "Powered by NUMU",
};

const RTL_LOCALES = new Set(["ar", "he", "fa", "ur"]);

/**
 * Resolve the active store's preferred language from the request URL.
 *
 * In production with subdomain routing the proxy.ts middleware
 * rewrites `<sub>.numueg.app/X` to `/<sub>/X`, and the path's first
 * segment is the store's subdomain. In dev with path-segment routing
 * the URL already has that shape. Either way we read the path from
 * the `x-numu-pathname` header that the proxy stamps (added below)
 * and look up the store.
 *
 * Failure modes are non-fatal: any error → English LTR. The render
 * still works; merchants just don't get the right `lang`/`dir`
 * attributes.
 */
async function resolveLocale(): Promise<{ lang: string; dir: "ltr" | "rtl" }> {
  try {
    const h = await headers();
    // Phase 3.6 — visitor-chosen locale wins over store default. The
    // proxy resolves `?locale=<code>` querystring + `numu_locale`
    // cookie and stamps the result on `x-numu-locale`. Empty header
    // means "no override" — fall through to the store's
    // default_language as before.
    const visitorLocale = h.get("x-numu-locale");
    if (visitorLocale) {
      return {
        lang: visitorLocale,
        dir: RTL_LOCALES.has(visitorLocale) ? "rtl" : "ltr",
      };
    }
    const path = h.get("x-numu-pathname") || h.get("x-invoke-path") || "";
    const seg = path.split("/").filter(Boolean)[0];
    const POST_DOMAIN = new Set([
      "collections",
      "products",
      "cart",
      "checkout",
      "account",
      "search",
      "pages",
      "blogs",
      "_next",
      "api",
    ]);
    if (!seg || POST_DOMAIN.has(seg)) {
      return { lang: "en", dir: "ltr" };
    }
    const store = await fetchStoreByDomain(seg).catch(() => null);
    const lang = (store?.default_language as string) || "en";
    return { lang, dir: RTL_LOCALES.has(lang) ? "rtl" : "ltr" };
  } catch {
    return { lang: "en", dir: "ltr" };
  }
}

/**
 * Phase 7.3 — resolve the active theme's static template URLs (error
 * + loading) and surface them on the <html> element via data
 * attributes. The client-side error.tsx and loading.tsx routes read
 * these on mount and fetch+inject the theme's HTML when present,
 * falling back to the platform's hardcoded chrome when absent or on
 * a fetch failure.
 *
 * Why data attrs (not React state): error.tsx fires when the bundle
 * has thrown — we can't rely on a React provider being mounted. A
 * vanilla `document.documentElement.dataset.*` read always works.
 */
type ThemeStaticTemplates = {
  errorUrl: string | null;
  loadingUrl: string | null;
  /** BYOT bundle entry — modulepreloaded so it downloads during HTML parse. */
  bundleUrl: string | null;
  /** BYOT stylesheet — preloaded alongside the bundle. */
  cssUrl: string | null;
};

const NO_TEMPLATES: ThemeStaticTemplates = {
  errorUrl: null,
  loadingUrl: null,
  bundleUrl: null,
  cssUrl: null,
};

async function resolveThemeStaticTemplates(): Promise<ThemeStaticTemplates> {
  try {
    const h = await headers();
    const path = h.get("x-numu-pathname") || h.get("x-invoke-path") || "";
    const seg = path.split("/").filter(Boolean)[0];
    if (!seg) return NO_TEMPLATES;
    const store = await fetchStoreByDomain(seg).catch(() => null);
    if (!store) return NO_TEMPLATES;
    const themeRaw = await fetchThemeSettings(store.id).catch(() => null);
    if (!themeRaw) return NO_TEMPLATES;
    const themeSettings = resolveThemeSettings(
      themeRaw?.theme_settings || themeRaw || {},
    );
    if (
      !themeSettings.external_theme?.bundle_url ||
      isBuiltInTheme(themeSettings.theme_id)
    ) {
      return NO_TEMPLATES;
    }
    const ext = themeSettings.external_theme as unknown as {
      error_template_url?: string;
      loading_template_url?: string;
      bundle_url?: string;
      css_url?: string;
    };
    return {
      errorUrl: typeof ext.error_template_url === "string" ? ext.error_template_url : null,
      loadingUrl: typeof ext.loading_template_url === "string" ? ext.loading_template_url : null,
      bundleUrl: typeof ext.bundle_url === "string" ? ext.bundle_url : null,
      cssUrl: typeof ext.css_url === "string" ? ext.css_url : null,
    };
  } catch {
    return NO_TEMPLATES;
  }
}

/** Origin of a CDN url, for a <link rel="preconnect">. Null if unparseable. */
function originOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { lang, dir } = await resolveLocale();
  const { errorUrl, loadingUrl, bundleUrl, cssUrl } =
    await resolveThemeStaticTemplates();
  const cdnOrigin = originOf(bundleUrl);
  return (
    <html
      lang={lang}
      dir={dir}
      data-numu-error-template-url={errorUrl || undefined}
      data-numu-loading-template-url={loadingUrl || undefined}
    >
      <head>
        {/*
          Preload the BYOT theme bundle + CSS so the browser fetches them
          DURING HTML parse (in parallel with hydration) instead of waiting
          for the ByotThemeBoundary effect to fire post-hydration. This is the
          single biggest cut to the "blank for a second" gap on every page —
          modulepreload cascades to the bundle's static chunk imports too.
        */}
        {cdnOrigin && (
          <link rel="preconnect" href={cdnOrigin} crossOrigin="anonymous" />
        )}
        {bundleUrl && (
          <link rel="modulepreload" href={bundleUrl} crossOrigin="anonymous" />
        )}
        {cssUrl && <link rel="preload" as="style" href={cssUrl} />}
        {/*
          BYOT runtime import map. Federated theme bundles import
          `react`, `react/jsx-runtime`, `react-dom/client`, and
          `@numu/theme-sdk` as bare specifiers. Without an import map
          parsed by the browser BEFORE the bundle's dynamic import runs,
          those imports throw "Failed to resolve module specifier".

          Must live in <head> so the HTML parser sees it before the
          ByotThemeBoundary effect (which fires after hydration but
          uses an import map that was committed at parse time, per
          spec). Self-contained themes (federate: false) ignore it.
        */}
        <RuntimeImportMap />
      </head>
      {/* suppressHydrationWarning: browser extensions (Grammarly,
          LastPass, etc.) inject data-* attributes onto <body> before
          React hydrates, producing noisy mismatch warnings that are
          out of our control. Suppression here is scoped to body's own
          attributes — children still hydrate strictly. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
