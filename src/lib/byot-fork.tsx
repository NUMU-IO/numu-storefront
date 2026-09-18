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
 * Whether the active external theme has EXPLICITLY taken ownership of a
 * platform-owned document (the checkout flow, or the password gate).
 *
 * Both are platform-owned by default (the Shopify model): payment gateways,
 * server-priced shipping, PII handling, order placement and the unlock
 * credential all live in the host, so every store — including BYOT — gets a
 * complete, secure version for free. Themes generally do NOT (and must not be
 * forced to) re-implement them, so handing them one of these page types just
 * renders a blank page. That was the "checkout has no sections" bug:
 * bon-younes (and every current theme) ships no checkout section, so the
 * bundle drew nothing. The password gate had the same hole — no V3 theme
 * renders `password` either, so a locked store served its header and footer
 * around an empty middle, with no way to enter the password.
 *
 * Ownership is signalled ONLY by an explicit manifest opt-in:
 *   `external_theme.capabilities.<capability> === true`.
 *
 * We deliberately do NOT infer ownership from the presence of a matching
 * template: EVERY theme ships a `checkout` template carrying the
 * header/footer CHROME (its page content empty), so a "non-empty template"
 * heuristic false-positives and hands the blank bundle the page — the exact
 * bug this removes. Explicit opt-in is the contract; no current theme sets
 * either flag, so the built-in pages always render.
 */
function themeClaims(
  theme: ThemeSettingsV3,
  capability: "checkout" | "password",
): boolean {
  const ext = theme.external_theme as
    | (NonNullable<ThemeSettingsV3["external_theme"]> & {
        capabilities?: Record<string, boolean | undefined> | null;
      })
    | undefined;
  return ext?.capabilities?.[capability] === true;
}

/**
 * The capability a fork point needs the theme to claim, or null when the
 * theme owns the page by default (home, PDP, PLP, error, …).
 */
function requiredCapability(
  type: string | undefined,
): "checkout" | "password" | null {
  if (typeof type !== "string") return null;
  if (type.startsWith("checkout")) return "checkout";
  if (type === "password") return "password";
  return null;
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

  const capability = requiredCapability(page.type);

  if (
    themeSettings.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id) &&
    // Checkout and the password gate are platform-owned unless the theme
    // explicitly claims them (see themeClaims). Every other fork point is
    // the theme's page by default.
    (capability === null || themeClaims(themeSettings, capability))
  ) {
    return {
      kind: "byot",
      element: (
        <ByotThemeBoundary
          bundleUrl={themeSettings.external_theme.bundle_url}
          cssUrl={themeSettings.external_theme.css_url}
          bundleChecksum={themeSettings.external_theme.checksum}
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
        themeClaims(themeSettings, "checkout"),
    );
  } catch {
    return false;
  }
}
