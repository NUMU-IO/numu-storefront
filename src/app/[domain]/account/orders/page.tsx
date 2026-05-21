/**
 * /account/orders — customer order history.
 *
 * SSR-fetches the order list with the cookie session. Anonymous visitors
 * are redirected to /account/login. BYOT bundles see `page.type =
 * "account_orders"` with `page.data.{customer, orders}`; built-in falls
 * back to OrdersList from Dashboard.tsx.
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
import { OrdersList } from "@/components/account/Dashboard";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    return { title: `Orders | ${store?.name || "Store"}` };
  } catch {
    return { title: "Orders" };
  }
}

export default async function OrdersPage({ params }: PageProps) {
  const { domain } = await params;
  const headerList = await headers();
  const cookieHeader = headerList.get("cookie");

  const customer = await fetchCurrentCustomer(cookieHeader);
  if (!customer) redirect("/account/login");

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
        page={{
          type: "account_orders",
          title: "Orders",
          data: { customer, orders },
        }}
      />
    );
  }

  return <OrdersList customer={customer} initialOrders={orders} />;
}
