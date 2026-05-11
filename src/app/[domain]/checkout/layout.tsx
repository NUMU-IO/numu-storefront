/**
 * Checkout layout — Phase 1.2 + Phase 7.1 BYOT fork.
 *
 * Built-in chrome (logo header + Powered by NUMU footer) wraps the
 * step pages only when the store does NOT have an external BYOT
 * theme installed. When BYOT is active, the layout becomes a
 * passthrough — themes own the full checkout document.
 */

import { fetchStoreByDomain } from "@/lib/api-client";
import { isByotActive } from "@/lib/byot-fork";
import Link from "next/link";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ domain: string }>;
}

export default async function CheckoutLayout({ children, params }: LayoutProps) {
  const { domain } = await params;

  // Phase 7.1 — when BYOT is active, suppress all built-in chrome.
  // The theme bundle owns the full page via the per-step BYOT fork.
  if (await isByotActive(domain)) {
    return <>{children}</>;
  }

  let store;
  try {
    store = await fetchStoreByDomain(domain);
  } catch {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Store not found
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b bg-white">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          {store?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={store.logo_url}
              alt={store.name || "Store"}
              className="h-8 w-auto"
            />
          ) : (
            <span className="font-semibold text-lg">
              {store?.name || "Store"}
            </span>
          )}
          <span className="text-sm text-gray-500">— Checkout</span>
          <div className="ml-auto">
            <Link
              href="/cart"
              className="text-sm text-gray-600 hover:text-gray-900 underline"
            >
              Return to cart
            </Link>
          </div>
        </div>
      </header>
      <main
        id="main"
        className="max-w-3xl mx-auto px-4 py-8"
        aria-label="Checkout"
      >
        {children}
      </main>
      <footer className="border-t bg-white mt-12">
        <div className="max-w-5xl mx-auto px-4 py-6 text-xs text-gray-500 flex justify-between">
          <span>Secure checkout — Powered by NUMU</span>
          <Link href="/policies/privacy" className="underline">
            Privacy
          </Link>
        </div>
      </footer>
    </div>
  );
}
