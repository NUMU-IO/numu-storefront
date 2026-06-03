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
import { fetchStoreByDomain } from "@/lib/api-client";
import { themeOwnsCheckout } from "@/lib/byot-fork";
import { CheckoutTrustBadges } from "@/components/checkout/CheckoutTrustBadges";
import { OrderSummary } from "@/components/checkout/OrderSummary";
import Link from "next/link";

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
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100/40">
      <header className="border-b border-gray-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-4">
          {store?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={store.logo_url}
              alt={store.name || "Store"}
              className="h-8 w-auto"
            />
          ) : (
            <span className="text-lg font-semibold tracking-tight text-gray-900">
              {store?.name || "Store"}
            </span>
          )}
          <span className="hidden text-sm text-gray-400 sm:inline">
            {isAr ? "— إتمام الطلب" : "— Checkout"}
          </span>
          <div className="ms-auto">
            <Link
              href="/cart"
              className="text-sm font-medium text-gray-500 underline-offset-4 transition-colors hover:text-gray-900 hover:underline"
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

        {showSummary && <CheckoutTrustBadges locale={locale} />}
      </main>

      <footer className="mt-12 border-t border-gray-200/70 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-6 text-xs text-gray-500">
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
            className="underline-offset-4 hover:text-gray-900 hover:underline"
          >
            {isAr ? "الخصوصية" : "Privacy"}
          </Link>
        </div>
      </footer>
    </div>
  );
}
