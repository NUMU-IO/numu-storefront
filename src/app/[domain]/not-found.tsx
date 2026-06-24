/**
 * /[domain]/not-found.tsx — store-scoped 404.
 *
 * Renders the active theme's `not_found` template (or `page` fallback)
 * for BYOT bundles, so 404 pages match brand. Built-in fallback shows
 * a generic message linking back to the storefront root.
 *
 * Why we resolve the store from `host` here instead of params:
 *   Next 15's not-found.tsx receives no props, even when nested under a
 *   dynamic segment. We pull the hostname from the request and run it
 *   through fetchStoreByHost (the same lookup the [domain]/layout uses),
 *   which handles subdomain vs custom-domain distinction. If that
 *   resolution fails (e.g. the platform apex 404s), we render a static
 *   fallback so the page never crashes.
 */
import { headers } from "next/headers";
import {
  fetchStoreByHost,
  fetchThemeSettings,
} from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import { NumuDefaultShell } from "@/components/storefront/NumuDefaultShell";

export default async function StoreNotFound() {
  const headerList = await headers();
  // Prefer the proxy-stamped hostname; fall back to host header for
  // direct hits (e.g. a request that bypassed the proxy in dev).
  const host =
    headerList.get("x-numu-host") ||
    (headerList.get("host") || "").split(":")[0];

  let store: any = null;
  let themeSettings: any = null;

  if (host) {
    try {
      store = await fetchStoreByHost(host);
      const themeRaw = await fetchThemeSettings(store.id).catch(() => null);
      themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});
    } catch {
      /* fall through to static fallback */
    }
  }

  const isByot =
    !!themeSettings?.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id);

  // ENG-3: bilingual 404 — this fallback shows on Arabic stores too.
  const ar = (
    headerList.get("x-numu-locale") || store?.default_language || "en"
  )
    .toLowerCase()
    .startsWith("ar");
  const T = (en: string, arText: string) => (ar ? arText : en);

  // Branded NUMU 404 — used both as the built-in fallback and as the ENG-2
  // backstop for BYOT bundles that ship no `404` template (else blank).
  const fallback404 = (
    <NumuDefaultShell
      ar={ar}
      eyebrow={store?.name || "NUMU"}
      title="404"
      message={T(
        "We couldn't find the page you were looking for.",
        "مش لاقيين الصفحة اللي بتدوّر عليها.",
      )}
      action={{
        href: "/",
        label: `${T("Back to", "ارجع لـ")} ${store?.name || T("store", "المتجر")}`,
      }}
    />
  );

  if (isByot && store) {
    return (
      <ByotThemeBoundary
        bundleUrl={themeSettings.external_theme!.bundle_url!}
        cssUrl={themeSettings.external_theme!.css_url}
        themeSettings={themeSettings}
        storeData={store}
        page={{ type: "404", title: "Page not found" }}
        routeFallback={fallback404}
      />
    );
  }

  return fallback404;
}
