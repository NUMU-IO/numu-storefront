/**
 * Checkout layout — Phase 1.2.
 *
 * Frames every step (contact → shipping → payment → review →
 * processing) with the same chrome: a progress strip + a container
 * that resolves the store from `[domain]` and exposes its currency
 * to the step pages via context.
 *
 * Kept deliberately minimal — Shopify-style functional checkout, not
 * a BYOT-rendered surface. Merchants who want a branded checkout
 * customize via store settings (logo URL, accent colors) which the
 * future <CheckoutChrome> can read. For v1 we ship a clean default.
 */

import { fetchStoreByDomain } from "@/lib/api-client";
import Link from "next/link";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ domain: string }>;
}

export default async function CheckoutLayout({ children, params }: LayoutProps) {
  const { domain } = await params;
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
