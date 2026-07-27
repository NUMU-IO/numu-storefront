/**
 * Per-request entry point for isolated theme SSR.
 *
 * One call from a route's Server Component produces the `ssrHtml` prop for
 * `ByotThemeBoundary`. Everything risky lives behind it: the flag check, the
 * sandboxed worker, the provenance gates, the timeout, the breaker.
 *
 * Its real job is PARITY. The server render and the client's first render
 * must receive the same ctx or hydration mismatches, so this assembles the
 * ctx from exactly the sources `ByotThemeBoundary` reads on the client:
 *
 *   themeSettings → dynamic sources resolved with the same store/product/
 *                   collection context (`resolveThemeSettingsDynamicSources`)
 *   locale        → `x-numu-locale` (what the layout threads into ThemeData)
 *   navigation    → `fetchStoreMenus(store.id)` (React.cache'd — the layout
 *                   already fetched it this request, so this is free)
 *   demo          → always false; preview requests are skipped entirely
 *
 * Returns `null` for every "not today" case. Callers pass the result straight
 * through; `null` means the storefront behaves exactly as it does now.
 */

import { headers } from "next/headers";

import { fetchStoreMenus } from "./api-client";
import { resolveThemeSettingsDynamicSources } from "./resolve-dynamic-sources";
import { isThemeSsrEnabled, renderThemeSsr } from "./ssr-theme";
import type { Collection, PageContextData, Product, StoreData, ThemeSettingsV3 } from "@/types";

export interface ThemeSsrRequest {
  themeSettings: ThemeSettingsV3;
  store: StoreData;
  /** The SAME page descriptor handed to ByotThemeBoundary. */
  page: PageContextData;
}

export async function resolveThemeSsrHtml({
  themeSettings,
  store,
  page,
}: ThemeSsrRequest): Promise<string | null> {
  // Cheapest possible bail-out: with the flag off this costs one env read and
  // never touches headers, the network or a child process.
  if (!isThemeSsrEnabled()) return null;

  const bundleUrl = themeSettings.external_theme?.bundle_url;
  if (!bundleUrl) return null;

  try {
    const h = await headers();
    // Marketplace preview renders a DIFFERENT tree (demo placeholders), and
    // the client derives `demo` from the URL — server-rendering it would
    // guarantee a mismatch. Skip rather than guess.
    const isPreview = Boolean(h.get("x-numu-preview-slug"));
    if (isPreview) return null;

    const locale =
      h.get("x-numu-locale") ||
      (store as { default_language?: string })?.default_language ||
      undefined;

    const navigation = await fetchStoreMenus(store.id).catch(() => ({}));

    const resolved = resolveThemeSettingsDynamicSources(themeSettings, {
      store,
      product: (page?.data?.product as Product | undefined) ?? null,
      collection: (page?.data?.collection as Collection | undefined) ?? null,
    });

    return await renderThemeSsr({
      bundleUrl,
      themeSettings: resolved,
      storeData: store,
      page,
      locale,
      navigation,
      isPreview: false,
    });
  } catch {
    // A failure here must never cost the page — the client mount still works.
    return null;
  }
}
