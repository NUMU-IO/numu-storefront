"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";

/**
 * Step 5 — payment processing.
 *
 * Gateway callbacks redirect here with `?order=<order_id>` in the URL.
 * We poll the order status every 2s for up to 60s. On terminal status
 * (paid / completed) we forward to the thank-you page. On failure we
 * surface an error + offer a back-to-cart link.
 *
 * Some gateways skip this page entirely and redirect straight to
 * thank-you; this step is the safety net for ones that need a moment
 * to finalize.
 */

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_DURATION_MS = 60_000;

export function ProcessingStep() {
  const router = useRouter();
  const params = useParams() as { domain: string };
  const [error, setError] = useState<string | null>(null);
  const stopped = useRef(false);

  useEffect(() => {
    const urlOrder = new URLSearchParams(window.location.search).get("order");
    let stash: { order_id?: string; order_number?: string } | null = null;
    try {
      const raw = window.sessionStorage.getItem("numu_checkout_pending_order");
      if (raw) stash = JSON.parse(raw);
    } catch {
      /* swallow */
    }
    const orderId = urlOrder || stash?.order_id;
    if (!orderId) {
      setError("No order to track. Return to your cart and try again.");
      return;
    }

    const orderNumber = stash?.order_number || "";
    const start = Date.now();

    async function poll() {
      if (stopped.current) return;
      try {
        const res = await fetch(`/api/customer/orders/${orderId}`, {
          cache: "no-store",
        });
        if (res.ok) {
          const body = await res.json();
          const order = body?.data || body;
          const paid =
            order?.payment_status === "paid" ||
            order?.payment_status === "completed" ||
            order?.status === "paid" ||
            order?.status === "confirmed";
          if (paid) {
            window.sessionStorage.removeItem("numu_checkout_pending_order");
            router.replace(
              `/${params.domain}/checkout/${orderId}/thank-you${
                orderNumber ? `?n=${encodeURIComponent(orderNumber)}` : ""
              }`,
            );
            return;
          }
        }
      } catch {
        /* swallow — keep polling until timeout */
      }
      if (Date.now() - start > POLL_MAX_DURATION_MS) {
        setError(
          "Payment is taking longer than expected. We'll email a confirmation once it clears.",
        );
        return;
      }
      window.setTimeout(poll, POLL_INTERVAL_MS);
    }
    poll();

    return () => {
      stopped.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-[50vh] flex flex-col items-center justify-center text-center"
    >
      {!error ? (
        <>
          <svg
            className="h-10 w-10 animate-spin text-gray-700 mb-4"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeWidth="3"
            />
            <path
              d="M22 12a10 10 0 0 1-10 10"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
          </svg>
          <p className="text-gray-700">Confirming your payment…</p>
          <p className="text-sm text-gray-500 mt-1">
            Please don't close this tab.
          </p>
        </>
      ) : (
        <div role="alert" className="max-w-md space-y-3">
          <p className="text-gray-900 font-medium">{error}</p>
          <a
            href={`/${params.domain}/cart`}
            className="inline-block underline text-blue-700 text-sm"
          >
            Return to cart
          </a>
        </div>
      )}
    </div>
  );
}
