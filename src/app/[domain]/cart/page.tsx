/**
 * Cart page route. Mirrors the home/product/collection routes:
 *   - Resolve store from `[domain]`.
 *   - Resolve theme.
 *   - For BYOT themes, hand control to <ByotThemeBoundary> with
 *     `page.type = "cart"`. The bundle's NuMuProvider machinery hooks
 *     useCart() against /api/cart so the cart contents render live.
 *   - For built-in themes, fall back to PageTemplateRenderer with the
 *     `cart` template.
 *
 * The route doesn't pre-fetch cart contents — useCart() in the bundle
 * fires its own /api/cart call on mount, which is fine: cart state is
 * always fresh, never cached.
 */
import {
  fetchStoreByDomain,
  fetchThemeSettings,
} from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { PageTemplateRenderer } from "@/components/theme-engine/PageTemplateRenderer";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    return { title: `Cart | ${store?.name || "Store"}` };
  } catch {
    return { title: "Cart" };
  }
}

export default async function CartPage({ params }: PageProps) {
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

  const themeRaw = await fetchThemeSettings(store.id).catch(() => null);
  if (!themeRaw) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        No theme installed.
      </div>
    );
  }
  const themeSettings = resolveThemeSettings(
    themeRaw?.theme_settings || themeRaw || {},
  );

  if (
    themeSettings.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id)
  ) {
    return (
      <ByotThemeBoundary
        bundleUrl={themeSettings.external_theme.bundle_url}
        cssUrl={themeSettings.external_theme.css_url}
        themeSettings={themeSettings}
        storeData={store}
        page={{ type: "cart", title: "Cart" }}
      />
    );
  }

  const cartTemplate = themeSettings.templates?.cart;
  if (cartTemplate) {
    return (
      <PageTemplateRenderer
        template={cartTemplate}
        themeId={themeSettings.theme_id}
        storeData={store}
      />
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold">Cart</h1>
      <p className="text-gray-600 mt-4">
        No cart template configured.
      </p>
    </div>
  );
}
