/**
 * /account — customer account home (post-login dashboard).
 *
 * Reads the customer from the cookie-auth'd session. If anonymous,
 * redirects to /account/login. Hydrates BYOT bundles with
 * `page.data.{customer, recent_orders}`; falls back to the built-in
 * AccountHome when no theme bundle ships an `account` template.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  fetchStoreByDomain,
  fetchThemeSettings,
  fetchCurrentCustomer,
  fetchCustomerOrders,
} from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import { AccountHome } from "@/components/account/Dashboard";
import type { Metadata } from "next";
import { NOINDEX_ROBOTS } from "@/lib/seo";

interface PageProps {
  params: Promise<{ domain: string }>;
}

// Private customer surface. Emitting no `robots` key inherited the shell's
// `index, follow`, so every account route answered 200 as indexable — and
// robots.txt can't be the guard here (Cloudflare serves it for these hosts and
// allows everything), so the meta tag is the layer we actually control.
//
// Entity title only: the `[domain]` layout's title template appends the store
// name, so this no longer needs to resolve the store and is a static object.
export const metadata: Metadata = {
  title: "Account",
  robots: NOINDEX_ROBOTS,
};

export default async function AccountPage({ params }: PageProps) {
  const { domain } = await params;
  const headerList = await headers();
  const cookieHeader = headerList.get("cookie");

  const customer = await fetchCurrentCustomer(cookieHeader);
  if (!customer) redirect("/account/login");

  // Recent orders are inexpensive (paginated 1 page); fetched server-side
  // so the dashboard renders fully on first paint with no client fetch.
  const orders = await fetchCustomerOrders(cookieHeader);

  const store = await fetchStoreByDomain(domain);
  const themeRaw = await fetchThemeSettings(store.id).catch(() => null);
  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});

  const isByot =
    themeSettings.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id);

  if (isByot) {
    return (
      <ByotThemeBoundary
        bundleUrl={themeSettings.external_theme!.bundle_url!}
        bundleChecksum={themeSettings.external_theme!.checksum}
        cssUrl={themeSettings.external_theme!.css_url}
        themeSettings={themeSettings}
        storeData={store}
        // Themes declare their account template as `profile` (lux/vionne/bazar);
        // the route must send the matching type or the bundle finds no template
        // and renders blank. `routeFallback` is the ENG-2 no-blank backstop:
        // themes WITHOUT a profile section degrade to the built-in AccountHome
        // (functional) instead of a blank page.
        page={{
          type: "profile",
          title: "Account",
          data: { customer, recent_orders: orders },
        }}
        routeFallback={<AccountHome customer={customer} recentOrders={orders} />}
      />
    );
  }

  return <AccountHome customer={customer} recentOrders={orders} />;
}
