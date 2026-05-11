"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { StepIndicator } from "@/components/checkout/StepIndicator";
import {
  hasContactStep,
  patchCheckoutState,
  readCheckoutState,
} from "@/lib/checkout-state";
import type { ShippingRateOption } from "@/types/checkout";

/**
 * Step 2 — shipping rate selection.
 *
 * Posts the resolved address to /api/shipping/options; backend returns
 * the rates valid for that zone. Customer picks one and we save the
 * rate ID (the server re-resolves it on POST /checkout to prevent
 * tampering with the amount).
 *
 * No rates available → surface an inline error and a "go back to
 * address" link. Could happen when the merchant has zero zones
 * configured or the customer's country isn't covered.
 */

function formatCurrency(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function ShippingStep() {
  const router = useRouter();
  const params = useParams() as { domain: string };
  const [rates, setRates] = useState<ShippingRateOption[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const s = readCheckoutState();
    if (!hasContactStep(s)) {
      router.replace(`/${params.domain}/checkout`);
      return;
    }
    setSelected(s.selected_shipping_rate_id);
    (async () => {
      try {
        const res = await fetch("/api/shipping/options", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shipping_address: s.shipping_address,
          }),
        });
        if (!res.ok) {
          setError(
            res.status === 404
              ? "We don't ship to that location yet."
              : "Couldn't load shipping options. Please try again.",
          );
          setRates([]);
          return;
        }
        const body = await res.json();
        const list: ShippingRateOption[] =
          (body?.data?.options ||
            body?.data ||
            body?.options ||
            []) as ShippingRateOption[];
        setRates(list);
        // Auto-select the cheapest rate so the customer can hit
        // continue without an extra click for the common case.
        if (list.length && !s.selected_shipping_rate_id) {
          const cheapest = [...list].sort(
            (a, b) => a.amount_cents - b.amount_cents,
          )[0];
          setSelected(cheapest.id);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setRates([]);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) {
      setError("Pick a shipping option to continue.");
      return;
    }
    const rate = rates?.find((r) => r.id === selected);
    patchCheckoutState({
      selected_shipping_rate_id: selected,
      shipping_method: rate?.name || null,
    });
    router.push(`/${params.domain}/checkout/payment`);
  }

  return (
    <>
      <StepIndicator current="shipping" />
      <form onSubmit={submit} className="space-y-6">
        <section
          className="bg-white p-6 rounded border"
          aria-labelledby="ship-heading"
        >
          <h2 id="ship-heading" className="text-lg font-semibold mb-4">
            Shipping method
          </h2>
          {loading && (
            <p className="text-sm text-gray-500">Loading shipping options…</p>
          )}
          {!loading && rates && rates.length === 0 && (
            <p className="text-sm text-gray-700">
              No shipping options available for this address.{" "}
              <Link
                href={`/${params.domain}/checkout`}
                className="underline text-blue-700"
              >
                Edit address
              </Link>
            </p>
          )}
          {!loading && rates && rates.length > 0 && (
            <ul className="space-y-2">
              {rates.map((r) => (
                <li key={r.id}>
                  <label
                    className="flex items-center gap-3 border rounded p-3 hover:bg-gray-50 cursor-pointer"
                    htmlFor={`rate-${r.id}`}
                  >
                    <input
                      id={`rate-${r.id}`}
                      type="radio"
                      name="rate"
                      checked={selected === r.id}
                      onChange={() => setSelected(r.id)}
                    />
                    <span className="flex-1">
                      <span className="font-medium block">{r.name}</span>
                      {(r.estimated_days_min || r.estimated_days_max) && (
                        <span className="text-xs text-gray-500">
                          {r.estimated_days_min ?? "?"}–
                          {r.estimated_days_max ?? "?"} business days
                          {r.carrier ? ` · ${r.carrier}` : ""}
                        </span>
                      )}
                    </span>
                    <span className="font-medium">
                      {formatCurrency(r.amount_cents, r.currency)}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        {error && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 text-red-700 text-sm rounded p-3"
          >
            {error}
          </div>
        )}

        <div className="flex justify-between items-center">
          <Link
            href={`/${params.domain}/checkout`}
            className="text-sm underline text-gray-700"
          >
            ‹ Back to contact
          </Link>
          <button
            type="submit"
            disabled={!selected}
            className="bg-gray-900 text-white px-6 py-2 rounded hover:bg-gray-800 disabled:opacity-50"
          >
            Continue to payment
          </button>
        </div>
      </form>
    </>
  );
}
