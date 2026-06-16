/**
 * /account/gift-cards — check a gift card balance.
 *
 * v1 ships a form-driven balance probe: the customer pastes a code,
 * we hit the public /api/gift-cards/{code} endpoint, and surface the
 * remaining balance + last four. Listing "my gift cards" needs a
 * customer-scoped backend endpoint (gift_card.customer_id is already
 * populated when a card is issued to a customer) — that lands in a
 * follow-up.
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
import GiftCardCheckClient from "@/components/account/GiftCardCheckClient";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string }>;
}

export const metadata: Metadata = { title: "Gift cards" };

export default async function GiftCardsPage({ params }: PageProps) {
  const { domain } = await params;
  const headerList = await headers();
  const cookieHeader = headerList.get("cookie");

  const customer = await fetchCurrentCustomer(cookieHeader);
  if (!customer) redirect("/account/login");

  const store = await fetchStoreByDomain(domain);
  const themeRaw = await fetchThemeSettings(store.id).catch(() => null);
  const themeSettings = resolveThemeSettings(
    themeRaw?.theme_settings || themeRaw || {},
  );

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
          type: "account_gift_cards",
          title: "Gift cards",
          data: { customer },
        }}
        // ENG-2: themes ship no `account_gift_cards` template — fall back to
        // the built-in balance checker so the page is never blank.
        routeFallback={<GiftCardCheckClient />}
      />
    );
  }

  return <GiftCardCheckClient />;
}
