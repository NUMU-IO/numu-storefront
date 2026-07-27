/**
 * /account/profile — edit name/phone/marketing-opt-in + change password.
 *
 * Profile mutations go through /api/customer/me, password change goes
 * through /api/customer/me/password — both CSRF-protected proxies that
 * forward to the backend with the session cookie.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  fetchStoreByDomain,
  fetchThemeSettings,
  fetchCurrentCustomer,
} from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import { ProfilePage } from "@/components/account/Dashboard";
import type { Metadata } from "next";
import { NOINDEX_ROBOTS } from "@/lib/seo";

interface PageProps {
  params: Promise<{ domain: string }>;
}

// Entity title only — the `[domain]` layout's title template appends the store
// name, so this no longer needs to resolve the store.
export const metadata: Metadata = {
  title: "Profile",
  robots: NOINDEX_ROBOTS,
};

export default async function ProfileRoute({ params }: PageProps) {
  const { domain } = await params;
  const headerList = await headers();
  const cookieHeader = headerList.get("cookie");

  const customer = await fetchCurrentCustomer(cookieHeader);
  if (!customer) redirect("/account/login");

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
        page={{
          type: "account_profile",
          title: "Profile",
          data: { customer },
        }}
        // ENG-2: themes ship no `account_profile` template — fall back to the
        // functional built-in so the page is never blank.
        routeFallback={<ProfilePage customer={customer} />}
      />
    );
  }

  return <ProfilePage customer={customer} />;
}
