/**
 * Public order-tracking route: /{domain}/track/{orderId}
 *
 * Guest-accessible (no auth) — anyone with the order's confirmation link can
 * view the live status. The order tracking URL emitted by checkout
 * (`{base}/track/{order_id}`) points here.
 *
 * A store with the Order Tracking app installed gets the app's view, which
 * falls back to core's view whenever the app's route fails; every other store
 * gets core's view exactly as before.
 */
import { headers } from "next/headers";
import { TrackApp } from "./TrackApp";
import { TrackOrder } from "./TrackOrder";
import { fetchStoreByDomain, fetchThemeSettings } from "@/lib/api-client";
import { primaryBrand } from "@/lib/brand-tokens";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { isArabicLocale, NOINDEX_ROBOTS } from "@/lib/seo";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

// Guest-accessible by design, which is exactly why it must not be indexed: the
// URL carries an order id and the page shows that buyer's status. robots.txt
// can't be relied on (Cloudflare serves it for these hosts and allows
// everything), so the meta tag is the enforceable layer. Robots only — the
// title stays inherited from the store shell rather than hardcoded English.
export const metadata: Metadata = { robots: NOINDEX_ROBOTS };

export default async function TrackPage({
  params,
}: {
  params: Promise<{ domain: string; orderId: string }>;
}) {
  const { domain, orderId } = await params;
  const core = <TrackOrder orderId={orderId} domain={domain} />;

  // The layout already loaded the store and its theme; both reads are cached.
  // The install list rides the store payload, so a store without the app makes
  // no extra request. ponytail: TrackApp shares this route's JS chunk, so every
  // store's /track downloads it (+5.5 KB gzip, 2026-10-18); lazy-load it if
  // that ever shows up in the page's budget.
  const store = await fetchStoreByDomain(domain).catch(() => null);
  if (!store?.installed_apps?.some((app) => app.slug === "order-tracking")) return core;

  const themeRaw = await fetchThemeSettings(store.id).catch(() => null);
  const globals = themeRaw
    ? (resolveThemeSettings(
        (themeRaw as { theme_settings?: unknown }).theme_settings || themeRaw || {},
      ).global_settings as Record<string, unknown> | undefined)
    : undefined;
  // The same language the root layout puts on <html lang>.
  const locale = (await headers()).get("x-numu-locale") || store.default_language || "en";

  return (
    <TrackApp
      orderId={orderId}
      ar={isArabicLocale(locale)}
      store={{ name: store.name, logo_url: store.logo_url ?? null, country: store.country }}
      brand={primaryBrand(globals)}
      fallback={core}
    />
  );
}
