/**
 * /account/addresses — saved address book CRUD.
 *
 * SSR-fetches the address list with the cookie session. Built-in
 * fallback uses AddressesPage which manages add/edit/delete/default
 * via the /api/customer/me/addresses proxy routes (CSRF-protected).
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  fetchStoreByDomain,
  fetchThemeSettings,
  fetchCurrentCustomer,
  fetchCustomerAddresses,
} from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import { AddressesPage } from "@/components/account/Dashboard";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    return { title: `Addresses | ${store?.name || "Store"}` };
  } catch {
    return { title: "Addresses" };
  }
}

export default async function AddressesRoute({ params }: PageProps) {
  const { domain } = await params;
  const headerList = await headers();
  const cookieHeader = headerList.get("cookie");

  const customer = await fetchCurrentCustomer(cookieHeader);
  if (!customer) redirect("/account/login");

  const addresses = await fetchCustomerAddresses(cookieHeader);

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
          type: "account_addresses",
          title: "Addresses",
          data: { customer, addresses },
        }}
        // ENG-2: themes ship no `account_addresses` template — fall back to the
        // functional built-in address book so the page is never blank.
        routeFallback={
          <AddressesPage customer={customer} initialAddresses={addresses as any} />
        }
      />
    );
  }

  return <AddressesPage customer={customer} initialAddresses={addresses as any} />;
}
