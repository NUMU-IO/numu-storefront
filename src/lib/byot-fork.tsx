/**
 * BYOT-fork helper for routes that need to delegate to an external
 * theme bundle. Phase 7.
 *
 * The shape every storefront page has been doing manually:
 *   1. fetch store
 *   2. fetch theme settings
 *   3. if BYOT installed → render <ByotThemeBoundary>
 *   4. else → render built-in fallback
 *
 * This helper consolidates steps 1-3 into a single SSR call so each
 * route just does:
 *
 *     const fork = await resolveByotFork(domain, { type: "checkout_contact" });
 *     if (fork.kind === "byot") return fork.element;
 *     if (fork.kind === "missing-store") return <NotFound/>;
 *     return <BuiltinFallback store={fork.store} />;
 *
 * Existing pages (cart, home, PDP, PLP, etc.) deliberately don't get
 * refactored — they work today and this helper just covers the new
 * checkout/password/error fork points.
 */

import { fetchStoreByDomain, fetchThemeSettings } from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import type { ReactElement } from "react";
import type { StoreData, ThemeSettingsV3 } from "@/types";

interface PageContextData {
  type: string;
  title?: string;
  handle?: string;
  data?: Record<string, unknown>;
}

export type ByotForkResult =
  | { kind: "missing-store" }
  | { kind: "byot"; element: ReactElement; store: StoreData; theme: ThemeSettingsV3 }
  | { kind: "builtin"; store: StoreData; theme: ThemeSettingsV3 | null };

export async function resolveByotFork(
  domain: string,
  page: PageContextData,
): Promise<ByotForkResult> {
  let store: StoreData;
  try {
    store = await fetchStoreByDomain(domain);
  } catch {
    return { kind: "missing-store" };
  }

  const themeRaw = await fetchThemeSettings(store.id).catch(() => null);
  if (!themeRaw) {
    return { kind: "builtin", store, theme: null };
  }

  const themeSettings = resolveThemeSettings(
    themeRaw?.theme_settings || themeRaw || {},
  );

  if (
    themeSettings.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id)
  ) {
    return {
      kind: "byot",
      element: (
        <ByotThemeBoundary
          bundleUrl={themeSettings.external_theme.bundle_url}
          cssUrl={themeSettings.external_theme.css_url}
          themeSettings={themeSettings}
          storeData={store}
          page={page}
        />
      ),
      store,
      theme: themeSettings,
    };
  }

  return { kind: "builtin", store, theme: themeSettings };
}

/**
 * True when the resolved theme is a BYOT bundle (not a built-in).
 * Used by layouts that need to suppress their chrome to let the
 * theme own the full page (e.g. the checkout layout).
 */
export async function isByotActive(domain: string): Promise<boolean> {
  try {
    const store = await fetchStoreByDomain(domain);
    const themeRaw = await fetchThemeSettings(store.id).catch(() => null);
    if (!themeRaw) return false;
    const themeSettings = resolveThemeSettings(
      themeRaw?.theme_settings || themeRaw || {},
    );
    return Boolean(
      themeSettings.external_theme?.bundle_url &&
        !isBuiltInTheme(themeSettings.theme_id),
    );
  } catch {
    return false;
  }
}
