/**
 * /account/orders/[id] — single order detail.
 *
 * Backend returns 404 if the order doesn't belong to the cookie's
 * customer, so we don't need an extra ownership check here.
 */
import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import {
  fetchStoreByDomain,
  fetchThemeSettings,
  fetchCurrentCustomer,
  fetchCustomerOrder,
} from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import { OrderDetail } from "@/components/account/Dashboard";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string; id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  return { title: `Order #${id.slice(0, 8)}` };
}

export default async function OrderDetailPage({ params }: PageProps) {
  const { domain, id } = await params;
  const headerList = await headers();
  const cookieHeader = headerList.get("cookie");

  const customer = await fetchCurrentCustomer(cookieHeader);
  if (!customer) redirect("/account/login");

  const order = await fetchCustomerOrder(cookieHeader, id);
  if (!order) notFound();

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
          type: "account_order",
          title: `Order #${(order as any).order_number || id.slice(0, 8)}`,
          data: { customer, order },
        }}
      />
    );
  }

  return <OrderDetail customer={customer} order={order} />;
}
