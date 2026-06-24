"use client";

import { useState } from "react";

interface KashierCheckoutProps {
  sessionUrl: string;
  amount?: string;
  currency?: string;
  orderNumber: string;
  onCancel: () => void;
  locale?: string;
}

/**
 * Kashier embedded payment (Payment Sessions API iframe) — ported from the
 * bazaar storefront. The backend returns payment_data = { provider:
 * "kashier", session_url, amount, currency } from POST /checkout; we render
 * the session in an iframe. Kashier redirects to the merchant return URL on
 * completion (configured backend-side → the /checkout/processing poller).
 *
 * NOTE: requires the storefront CSP frame-src to allow the Kashier domain.
 */
export function KashierCheckout({
  sessionUrl,
  amount,
  currency,
  orderNumber,
  onCancel,
  locale = "en",
}: KashierCheckoutProps) {
  const [loading, setLoading] = useState(true);
  const isAr = locale === "ar";

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-4 text-center">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className="mx-auto mb-2 text-gray-500"
        >
          <rect width="18" height="11" x="3" y="11" rx="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
        <h2 className="text-lg font-bold text-gray-900">
          {isAr ? "إتمام الدفع" : "Complete payment"}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          {isAr ? "طلب رقم" : "Order"} #{orderNumber}
          {amount ? ` — ${amount} ${currency || ""}` : ""}
        </p>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-gray-200">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white">
            <div className="text-center">
              <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gray-700 border-t-transparent" />
              <p className="mt-2 text-sm text-gray-500">
                {isAr ? "جارٍ تحميل نموذج الدفع…" : "Loading payment form…"}
              </p>
            </div>
          </div>
        )}
        <iframe
          src={sessionUrl}
          title="Kashier Payment"
          className="w-full border-0"
          style={{ height: "550px" }}
          onLoad={() => setLoading(false)}
          allow="payment"
        />
      </div>

      <div className="mt-3 text-center">
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-gray-500 underline transition-colors hover:text-gray-900"
        >
          {isAr ? "إلغاء والعودة" : "Cancel and go back"}
        </button>
      </div>
    </div>
  );
}
