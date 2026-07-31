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

/**
 * Optional per-store allowlist, layered UNDER the master `NUMU_SSR_THEME` flag.
 *
 * `NUMU_SSR_THEME_STORES=vionne` limits isolated SSR to that store; unset or
 * empty means "every store", i.e. exactly the behaviour the master flag had on
 * its own. Matching is on subdomain or slug, case-insensitively.
 *
 * Why this exists: `isThemeSsrEnabled()` is a single global env read, so
 * flipping the master flag turns SSR on for EVERY BYOT store at once — today
 * that is vionne and rabbit — across home, PDP and collection simultaneously.
 * That is a wide blast radius for a capability that forks a child process per
 * render, on a box that also hosts the MCP server, with no staging environment
 * to catch a regression first. This makes the rollout staged: enable one store,
 * watch it, then widen by editing one env var (no redeploy, no code change).
 *
 * Deliberately fails OPEN on an unparseable/empty value rather than closed —
 * a typo here should degrade to "current behaviour", not silently disable a
 * feature someone believes they switched on.
 */
function isSsrAllowedForStore(store: StoreData): boolean {
  const raw = (process.env.NUMU_SSR_THEME_STORES || "").trim();
  if (!raw) return true;
  const allowed = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
  if (allowed.size === 0) return true;
  const s = store as { subdomain?: string; slug?: string };
  const subdomain = (s.subdomain ?? "").trim().toLowerCase();
  const slug = (s.slug ?? "").trim().toLowerCase();
  return (
    (subdomain !== "" && allowed.has(subdomain)) ||
    (slug !== "" && allowed.has(slug))
  );
}

export async function resolveThemeSsrHtml({
  themeSettings,
  store,
  page,
}: ThemeSsrRequest): Promise<string | null> {
  // Cheapest possible bail-out: with the flag off this costs one env read and
  // never touches headers, the network or a child process.
  if (!isThemeSsrEnabled()) return null;
  // Staged rollout gate — see isSsrAllowedForStore. Also cheap: one env read
  // plus two string compares, before any header/network/child-process work.
  if (!isSsrAllowedForStore(store)) return null;

  const bundleUrl = themeSettings.external_theme?.bundle_url;
  if (!bundleUrl) return null;

  try {
    const h = await headers();
    // Marketplace preview renders a DIFFERENT tree (demo placeholders), and
    // the client derives `demo` from the URL — server-rendering it would
    // guarantee a mismatch. Skip rather than guess.
    //
    // `x-numu-editor` (stamped by proxy.ts from `?editor=`) covers the V3
    // customizer preview, which the marketplace check does NOT: the editor
    // opens `?preview=true&editor=v3` and carries no `preview_theme_slug`, so
    // SSR was running inside the editor iframe. That is the one surface where
    // server-rendered markup is actively wrong — the editor's whole loop is
    // posting live draft settings into the mounted bundle, and pre-rendering a
    // tree from the PUBLISHED settings means every session opens showing stale
    // content until the first keystroke repaints it. (Suite 11, D11-4.)
    const isPreview =
      Boolean(h.get("x-numu-preview-slug")) || Boolean(h.get("x-numu-editor"));
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
