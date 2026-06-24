/**
 * Checkout layout — Phase 1.2 + Phase 7.1 BYOT fork + Cluster 2 design pass.
 *
 * Built-in chrome (logo header + Powered by NUMU footer) wraps the step
 * pages only when the store does NOT have an external BYOT theme that
 * claims checkout. When a theme owns checkout, this becomes a passthrough —
 * the theme bundle draws the whole document.
 *
 * Design: a premium two-column shell on desktop (steps left, a sticky
 * order summary right) collapsing to a single column on mobile with a
 * collapsible summary bar at the top. Header logo + trust strip + a
 * "Secure checkout — Powered by NUMU" footer frame the flow.
 */

import { headers } from "next/headers";
import { fetchStoreByDomain, fetchThemeSettings } from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { themeOwnsCheckout } from "@/lib/byot-fork";
import type { CSSProperties } from "react";
import { resolveBrandTokens, brandVarsToCss } from "@/lib/brand-tokens";
import { CheckoutTrustBadges } from "@/components/checkout/CheckoutTrustBadges";
import { OrderSummary } from "@/components/checkout/OrderSummary";
import { NOINDEX_ROBOTS } from "@/lib/seo";
import Link from "next/link";
import type { Metadata } from "next";

// Checkout is transactional — never index any step (incl. thank-you).
export const metadata: Metadata = { robots: NOINDEX_ROBOTS };

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ domain: string }>;
}

export default async function CheckoutLayout({ children, params }: LayoutProps) {
  const { domain } = await params;

  // Checkout is platform-owned by default. Only a theme that EXPLICITLY
  // claims checkout (themeOwnsCheckout) gets the passthrough; every other
  // store keeps the platform chrome below.
  if (await themeOwnsCheckout(domain)) {
    return <>{children}</>;
  }

  let store;
  try {
    store = await fetchStoreByDomain(domain);
  } catch {
    return (
      <div className="flex min-h-screen items-center justify-center">
        Store not found
      </div>
    );
  }

  // Brand the platform checkout with the active theme's full design language
  // (colours + radius + border weight + heading/label treatment + fonts).
  const themeRaw = await fetchThemeSettings(store.id).catch(() => null);
  const brandGlobals = themeRaw
    ? (resolveThemeSettings(
        (themeRaw as { theme_settings?: unknown }).theme_settings || themeRaw || {},
      ).global_settings as Record<string, unknown> | undefined)
    : undefined;
  const brandVars = resolveBrandTokens(brandGlobals);

  const hdrs = await headers();
  const locale =
    hdrs.get("x-numu-locale") ||
    (store as { default_language?: string })?.default_language ||
    "en";
  const isAr = locale === "ar";

  // The order summary only belongs on the data-collection STEPS
  // (contact/shipping/payment/review) — not on the terminal pages
  // (processing/thank-you) where the cart is already cleared and the page
  // renders its own self-contained confirmation. Detect which child route
  // is active from the rewritten pathname the proxy stamps.
  const pathname = (
    hdrs.get("x-numu-pathname") ||
    hdrs.get("x-invoke-path") ||
    ""
  ).toLowerCase();
  // Strip any `/<domain>` prefix, then look at the checkout sub-path.
  const afterDomain = pathname.startsWith(`/${domain.toLowerCase()}`)
    ? pathname.slice(`/${domain.toLowerCase()}`.length)
    : pathname;
  // Terminal pages contain "/processing" or "/thank-you"; everything else
  // under /checkout is a step.
  const isTerminalPage =
    afterDomain.includes("/processing") ||
    afterDomain.includes("/thank-you");
  const showSummary = !isTerminalPage;

  return (
    <div
      className="min-h-screen bg-[var(--ck-bg)] text-[var(--ck-fg)] [font-family:var(--ck-body-font)]"
      style={brandVars as CSSProperties}
      data-checkout-root
    >
      {/* Mirror the tokens onto :root so React portals (the map-picker dialog,
          rendered into document.body) inherit the same brand palette. Scoped
          to the checkout route — unmounts when the visitor leaves checkout. */}
      <style
        dangerouslySetInnerHTML={{ __html: brandVarsToCss(brandVars) }}
      />
      {/* Brand accent bar — amber for bazar, the theme primary otherwise,
          transparent for an unbranded store (renders as before). */}
      <div aria-hidden className="h-1 w-full bg-[var(--ck-topbar)]" />
      <header className="border-b-[length:var(--ck-frame-width)] border-[var(--ck-frame)] bg-[var(--ck-surface)]/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4">
          {store?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={store.logo_url}
              alt={store.name || "Store"}
              className="h-8 w-auto"
            />
          ) : (
            <span className="text-lg text-[var(--ck-fg)] [font-family:var(--ck-heading-font)] [font-weight:var(--ck-heading-weight)] [letter-spacing:var(--ck-heading-tracking)] [text-transform:var(--ck-heading-transform)]">
              {store?.name || "Store"}
            </span>
          )}
          <span className="hidden text-[11px] text-[var(--ck-muted)] [font-weight:var(--ck-label-weight)] [letter-spacing:var(--ck-label-tracking)] [text-transform:var(--ck-label-transform)] sm:inline">
            {isAr ? "إتمام الطلب" : "Checkout"}
          </span>
          <div className="ms-auto">
            <Link
              href="/cart"
              className="text-sm font-medium text-[var(--ck-muted)] underline-offset-4 transition-colors hover:text-[var(--ck-fg)] hover:underline"
            >
              {isAr ? "العودة للسلة" : "Return to cart"}
            </Link>
          </div>
        </div>
      </header>

      <main
        id="main"
        className="mx-auto max-w-6xl px-4 py-6 sm:py-10"
        aria-label="Checkout"
      >
        {showSummary ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-10">
            {/* Left column — the active step. */}
            <div className="order-2 lg:order-1">{children}</div>
            {/* Right column — sticky order summary (collapsible on mobile,
                where it renders above the form via the order utilities). */}
            <div className="order-1 lg:order-2">
              <OrderSummary />
            </div>
          </div>
        ) : (
          // Terminal pages (processing / thank-you) — single centered column,
          // no order summary (cart is already cleared).
          <div className="mx-auto max-w-2xl">{children}</div>
        )}

      </main>

      <footer className="mt-12 border-t border-[var(--ck-border)] bg-[var(--ck-surface)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-6 text-xs text-[var(--ck-muted)]">
          <span className="inline-flex items-center gap-1.5">
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect width="18" height="11" x="3" y="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span>
              {isAr
                ? "دفع آمن — مشغّل بواسطة NUMU"
                : "Secure checkout — Powered by NUMU"}
            </span>
          </span>
          <Link
            href="/policies/privacy"
            className="underline-offset-4 transition-colors hover:text-[var(--ck-fg)] hover:underline"
          >
            {isAr ? "الخصوصية" : "Privacy"}
          </Link>
        </div>
      </footer>
    </div>
  );
}
