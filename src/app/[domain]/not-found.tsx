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

  if (isByot && store) {
    return (
      <ByotThemeBoundary
        bundleUrl={themeSettings.external_theme!.bundle_url!}
        cssUrl={themeSettings.external_theme!.css_url}
        themeSettings={themeSettings}
        storeData={store}
        page={{ type: "404", title: "Page not found" }}
      />
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <h1 className="text-5xl font-bold text-gray-900">404</h1>
        <p className="text-gray-600 mt-3">
          We couldn't find the page you were looking for.
        </p>
        <a
          href="/"
          className="inline-block mt-6 rounded-md bg-black px-4 py-2 text-white text-sm font-medium hover:bg-gray-800"
        >
          Back to {store?.name || "store"}
        </a>
      </div>
    </div>
  );
}
