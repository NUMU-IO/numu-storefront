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

/**
 * Whether the active external theme has EXPLICITLY taken ownership of the
 * checkout document.
 *
 * Checkout is platform-owned by default (the Shopify model): payment
 * gateways, server-priced shipping, PII handling and order placement all
 * live in the host, so every store — including BYOT — gets a complete,
 * secure, V2-parity checkout for free. Themes generally do NOT (and must
 * not be forced to) re-implement payment integrations, so handing them an
 * empty `checkout_*` page type just renders a blank page. That was the
 * "checkout has no sections" bug: bon-younes (and every current theme)
 * ships no checkout section, so the bundle drew nothing.
 *
 * Ownership is signalled ONLY by an explicit manifest opt-in:
 *   `external_theme.capabilities.checkout === true`.
 *
 * We deliberately do NOT infer ownership from the presence of a `checkout`
 * template: EVERY theme ships a `checkout` template carrying the
 * header/footer CHROME (its page content empty), so a "non-empty template"
 * heuristic false-positives and hands the blank bundle the checkout — the
 * exact bug this fix removes. Explicit opt-in is the contract; no current
 * theme sets it, so the built-in checkout always renders.
 */
function themeClaimsCheckout(theme: ThemeSettingsV3): boolean {
  const ext = theme.external_theme as
    | (NonNullable<ThemeSettingsV3["external_theme"]> & {
        capabilities?: { checkout?: boolean } | null;
      })
    | undefined;
  return ext?.capabilities?.checkout === true;
}

/** A checkout fork point (vs. password / error / other future forks). */
function isCheckoutPageType(type: string | undefined): boolean {
  return typeof type === "string" && type.startsWith("checkout");
}

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
    !isBuiltInTheme(themeSettings.theme_id) &&
    // Checkout is platform-owned unless the theme explicitly claims it
    // (see themeClaimsCheckout). Non-checkout fork points (e.g. the
    // storefront password gate) keep the original "any BYOT theme owns
    // the page" behaviour.
    (!isCheckoutPageType(page.type) || themeClaimsCheckout(themeSettings))
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

/**
 * True only when the active theme OWNS the checkout document (an external
 * theme that explicitly claims checkout — see themeClaimsCheckout). The
 * checkout layout uses this to decide chrome:
 *   - theme owns checkout  → passthrough (the bundle draws the whole page)
 *   - otherwise (default)  → wrap the host's built-in checkout steps in the
 *     platform chrome (logo header + secure footer + trust strip), INCLUDING
 *     for BYOT stores. This is what stops BYOT checkout from rendering blank.
 */
export async function themeOwnsCheckout(domain: string): Promise<boolean> {
  try {
    const store = await fetchStoreByDomain(domain);
    const themeRaw = await fetchThemeSettings(store.id).catch(() => null);
    if (!themeRaw) return false;
    const themeSettings = resolveThemeSettings(
      themeRaw?.theme_settings || themeRaw || {},
    );
    return Boolean(
      themeSettings.external_theme?.bundle_url &&
        !isBuiltInTheme(themeSettings.theme_id) &&
        themeClaimsCheckout(themeSettings),
    );
  } catch {
    return false;
  }
}
