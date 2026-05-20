/**
 * Server-side data fetch shared by every template page (cart, checkout,
 * order-confirmation, profile, /pages/[slug], etc.).
 *
 * Each route boils down to: "I am the {currentTemplate} template — fetch
 * the store + its theme + the catalog, decide whether the bundle path
 * (BYOT) or the built-in path renders." Pages call this helper from
 * their default async export, then render either ByotThemeBoundary or
 * PageTemplateRenderer with the result.
 *
 * Intentionally NOT a React component itself — Next.js wants the page
 * default export to be the server component, and that needs to own the
 * returned JSX so its conditional render lands at the right segment.
 */

import {
  fetchStoreByDomain,
  fetchThemeSettings,
  fetchProducts,
  fetchCollections,
} from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import type {
  ThemeSettingsV3,
  StoreData,
  Product,
  Collection,
  PageTemplate,
} from "@/types";

/**
 * Tolerates the `{ data: [...] }` envelope the backend wraps lists in
 * (and the legacy `{ items: [...] }`). Returns [] on anything else so
 * a transient backend hiccup doesn't crash the page render.
 */
export function unwrapList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === "object") {
    const r = raw as { data?: unknown; items?: unknown };
    if (Array.isArray(r.data)) return r.data as T[];
    if (Array.isArray(r.items)) return r.items as T[];
  }
  return [];
}

export interface TemplateContext {
  store: StoreData;
  themeSettings: ThemeSettingsV3;
  products: Product[];
  collections: Collection[];
  /** True when the store has an external theme bundle configured AND
   *  the theme_id isn't one of the built-in slugs — the page should
   *  render ByotThemeBoundary, not PageTemplateRenderer. */
  isByot: boolean;
}

/**
 * Resolve the data every template page needs. Theme + catalog fetch in
 * parallel; catalog failures degrade to empty arrays so the page still
 * renders (themes own the empty-state UX).
 */
export async function loadTemplateContext(
  domain: string,
): Promise<TemplateContext> {
  const store = await fetchStoreByDomain(domain);
  const [themeRaw, productsRaw, collectionsRaw] = await Promise.all([
    fetchThemeSettings(store.id),
    fetchProducts(store.id).catch(() => null),
    fetchCollections(store.id).catch(() => null),
  ]);
  const themeSettings = resolveThemeSettings(
    themeRaw?.theme_settings || themeRaw || {},
  );
  const products = unwrapList<Product>(productsRaw);
  const collections = unwrapList<Collection>(collectionsRaw);
  const isByot =
    !!themeSettings.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id);
  return { store, themeSettings, products, collections, isByot };
}

/** Lookup a template by key with the same null-safe shape every page wants. */
export function getTemplate(
  themeSettings: ThemeSettingsV3,
  key: string,
): PageTemplate | undefined {
  return themeSettings.templates?.[key];
}
