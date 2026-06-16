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

interface PageProps {
  params: Promise<{ domain: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    return { title: `Account | ${store?.name || "Store"}` };
  } catch {
    return { title: "Account" };
  }
}

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
