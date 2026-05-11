"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { StepIndicator } from "@/components/checkout/StepIndicator";
import {
  clearCheckoutState,
  hasPaymentStep,
  readCheckoutState,
} from "@/lib/checkout-state";
import type { CheckoutResponse } from "@/types/checkout";

/**
 * Step 4 — review + place order.
 *
 * Displays a summary of the collected info, lets the customer add an
 * order note + coupon, and on submit posts the full payload to
 * /api/checkout. The backend creates the order and returns either a
 * payment_url (redirect to gateway) or null (COD / completed). We
 * route to the appropriate next page:
 *   - payment_url present → /checkout/processing?next=<url>&order=<id>
 *   - else (COD / paid)  → /checkout/{order_id}/thank-you
 *
 * Cart line items live on the backend (Redis); the checkout endpoint
 * resolves them from the customer's session cookie. We send an empty
 * line_items list since the spec requires the field — server-side
 * the cart's contents take precedence over a stale client list.
 */

interface CartLine {
  product_id: string;
  variant_id?: string | null;
  quantity: number;
  unit_price?: number;
  subtotal?: number;
  product_name?: string;
}

function formatCents(cents: number, currency = "EGP") {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function ReviewStep() {
  const router = useRouter();
  const params = useParams() as { domain: string };
  const [cart, setCart] = useState<{ items: CartLine[]; total?: number; currency?: string } | null>(
    null,
  );
  const [notes, setNotes] = useState("");
  const [coupon, setCoupon] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [state] = useState(() => readCheckoutState());

  useEffect(() => {
    if (!hasPaymentStep(state)) {
      router.replace(`/${params.domain}/checkout/payment`);
      return;
    }
    setNotes(state.customer_notes || "");
    setCoupon(state.coupon_code || "");

    (async () => {
      try {
        const res = await fetch("/api/cart", { cache: "no-store" });
        if (res.ok) {
          const body = await res.json();
          setCart((body?.data || body) as typeof cart);
        }
      } catch {
        /* swallow — review still renders without summary */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function placeOrder(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    // Build the CheckoutRequest payload from collected state.
    // line_items is required by the schema but the backend resolves
    // from the cart anyway. We pass through whatever the cart has.
    const payload = {
      line_items: (cart?.items || []).map((l) => ({
        product_id: l.product_id,
        variant_id: l.variant_id || null,
        quantity: l.quantity,
      })),
      shipping_address: state.shipping_address,
      payment_method: state.payment_method,
      selected_shipping_rate_id: state.selected_shipping_rate_id,
      shipping_method: state.shipping_method,
      guest_email: state.email,
      cod_requested: state.cod_requested,
      deposit_gateway: state.deposit_gateway,
      customer_notes: notes || null,
      coupon_code: coupon || null,
    };

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Idempotency-Key prevents a double-click from charging twice.
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        const detail =
          body?.detail || body?.error || `Checkout failed (${res.status})`;
        setError(typeof detail === "string" ? detail : JSON.stringify(detail));
        setSubmitting(false);
        return;
      }
      const data = (body?.data || body) as CheckoutResponse;
      if (data.payment_url) {
        // Save order_id so the processing page can poll for completion
        // and the thank-you page can render after the gateway redirect.
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(
            "numu_checkout_pending_order",
            JSON.stringify({
              order_id: data.order_id,
              order_number: data.order_number,
            }),
          );
        }
        // Off to the gateway. The provider redirects back to
        // /checkout/processing or directly to thank-you.
        window.location.assign(data.payment_url);
        return;
      }
      // COD or already-completed → done. Clear state + thank-you.
      clearCheckoutState();
      router.replace(
        `/${params.domain}/checkout/${data.order_id}/thank-you?n=${encodeURIComponent(data.order_number)}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <>
      <StepIndicator current="review" />
      <form onSubmit={placeOrder} className="space-y-6">
        <section
          className="bg-white p-6 rounded border"
          aria-labelledby="cart-heading"
        >
          <h2 id="cart-heading" className="text-lg font-semibold mb-4">
            Order summary
          </h2>
          {!cart ? (
            <p className="text-sm text-gray-500">Loading cart…</p>
          ) : cart.items.length === 0 ? (
            <p className="text-sm text-red-700">
              Your cart is empty.{" "}
              <Link href={`/${params.domain}`} className="underline">
                Continue shopping
              </Link>
            </p>
          ) : (
            <ul className="divide-y">
              {cart.items.map((l, i) => (
                <li
                  key={`${l.product_id}-${l.variant_id || ""}-${i}`}
                  className="py-2 flex justify-between text-sm"
                >
                  <span>
                    <span className="font-medium">
                      {l.product_name || `Item ${l.product_id.slice(0, 8)}`}
                    </span>
                    <span className="text-gray-500"> × {l.quantity}</span>
                  </span>
                  <span>
                    {formatCents(l.subtotal ?? 0, cart.currency || "EGP")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white p-6 rounded border space-y-3">
          <h2 className="text-lg font-semibold">Shipping to</h2>
          <p className="text-sm text-gray-700">
            {state.shipping_address.first_name}{" "}
            {state.shipping_address.last_name}
            <br />
            {state.shipping_address.line1}
            {state.shipping_address.line2 && (
              <>
                <br />
                {state.shipping_address.line2}
              </>
            )}
            <br />
            {state.shipping_address.city}
            {state.shipping_address.state
              ? `, ${state.shipping_address.state}`
              : ""}
            {state.shipping_address.postal_code
              ? ` ${state.shipping_address.postal_code}`
              : ""}
            <br />
            {state.shipping_address.country}
          </p>
          <p className="text-sm text-gray-700">
            {state.shipping_method} · {state.email}
          </p>
        </section>

        <section className="bg-white p-6 rounded border space-y-3">
          <h2 className="text-lg font-semibold">Notes &amp; coupon</h2>
          <label className="block">
            <span className="text-sm text-gray-700">Order notes (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
              rows={3}
              className="mt-1 block w-full border rounded px-3 py-2"
            />
          </label>
          <label className="block">
            <span className="text-sm text-gray-700">Coupon code</span>
            <input
              value={coupon}
              onChange={(e) => setCoupon(e.target.value.toUpperCase())}
              maxLength={50}
              className="mt-1 block w-full border rounded px-3 py-2"
            />
          </label>
        </section>

        {error && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3 whitespace-pre-wrap"
          >
            {error}
          </div>
        )}

        <div className="flex justify-between items-center">
          <Link
            href={`/${params.domain}/checkout/payment`}
            className="text-sm underline text-gray-700"
          >
            ‹ Back to payment
          </Link>
          <button
            type="submit"
            disabled={submitting || !cart || cart.items.length === 0}
            className="bg-gray-900 text-white px-6 py-2 rounded hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? "Placing order…" : "Place order"}
          </button>
        </div>
      </form>
    </>
  );
}
