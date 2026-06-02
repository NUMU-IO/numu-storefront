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
import { formatCents } from "@/lib/money";

interface PickupLocation {
  id: string;
  name: string;
  name_ar?: string | null;
  address: Record<string, unknown>;
  pickup_instructions?: string | null;
  pickup_instructions_ar?: string | null;
}

type FulfillmentMode = "ship" | "pickup";

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
  return formatCents(cents, currency);
}

export function ShippingStep() {
  const router = useRouter();
  const params = useParams() as { domain: string };
  const [mode, setMode] = useState<FulfillmentMode>("ship");
  const [rates, setRates] = useState<ShippingRateOption[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pickupLocations, setPickupLocations] = useState<
    PickupLocation[] | null
  >(null);
  const [pickupId, setPickupId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const s = readCheckoutState();
    if (!hasContactStep(s)) {
      router.replace(`/${params.domain}/checkout`);
      return;
    }
    setSelected(s.selected_shipping_rate_id);
    setPickupId(s.pickup_location_id);
    setMode(s.pickup_location_id ? "pickup" : "ship");
    (async () => {
      // Parallel: shipping rates + pickup locations. Pickup is
      // resolved by store_id (not address) so it can fire immediately
      // without blocking on the address. The merchant's hub config
      // decides which locations are pickup-eligible.
      const ratesP = fetch("/api/shipping/options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipping_address: s.shipping_address }),
      });
      const pickupP = fetch("/api/storefront/pickup-locations", {
        cache: "no-store",
      }).catch(() => null);
      try {
        const [ratesRes, pickupRes] = await Promise.all([ratesP, pickupP]);

        // Shipping rates
        if (!ratesRes.ok) {
          if (ratesRes.status === 404) {
            // Country not covered — only an error if pickup also empty.
            setRates([]);
          } else {
            setError("Couldn't load shipping options. Please try again.");
            setRates([]);
          }
        } else {
          const body = await ratesRes.json();
          const list: ShippingRateOption[] =
            (body?.data?.options ||
              body?.data ||
              body?.options ||
              []) as ShippingRateOption[];
          setRates(list);
          if (list.length && !s.selected_shipping_rate_id) {
            const cheapest = [...list].sort(
              (a, b) => a.amount_cents - b.amount_cents,
            )[0];
            setSelected(cheapest.id);
          }
        }

        // Pickup locations
        if (pickupRes && pickupRes.ok) {
          const body = await pickupRes.json();
          const list = (body?.data || body || []) as PickupLocation[];
          setPickupLocations(Array.isArray(list) ? list : []);
        } else {
          setPickupLocations([]);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setRates([]);
        setPickupLocations([]);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "ship") {
      if (!selected) {
        setError("Pick a shipping option to continue.");
        return;
      }
      const rate = rates?.find((r) => r.id === selected);
      patchCheckoutState({
        selected_shipping_rate_id: selected,
        shipping_method: rate?.name || null,
        // Mutually exclusive with pickup.
        pickup_location_id: null,
      });
    } else {
      if (!pickupId) {
        setError("Pick a pickup location to continue.");
        return;
      }
      const loc = pickupLocations?.find((p) => p.id === pickupId);
      patchCheckoutState({
        pickup_location_id: pickupId,
        // Pickup forces shipping to a synthetic "Pickup" with $0 cost.
        selected_shipping_rate_id: null,
        shipping_method: loc?.name ? `Pickup at ${loc.name}` : "Pickup",
      });
    }
    router.push(`/${params.domain}/checkout/payment`);
  }

  const showPickupTab = (pickupLocations?.length ?? 0) > 0;

  return (
    <>
      <StepIndicator current="shipping" />
      <form onSubmit={submit} className="space-y-6">
        {showPickupTab && (
          <div
            role="tablist"
            aria-label="Fulfillment method"
            className="inline-flex border rounded overflow-hidden bg-white"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === "ship" ? "true" : "false"}
              onClick={() => setMode("ship")}
              className={`px-4 py-2 text-sm ${
                mode === "ship"
                  ? "bg-gray-900 text-white"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              Ship
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "pickup" ? "true" : "false"}
              onClick={() => setMode("pickup")}
              className={`px-4 py-2 text-sm ${
                mode === "pickup"
                  ? "bg-gray-900 text-white"
                  : "text-gray-700 hover:bg-gray-50"
              }`}
            >
              Pick up in store
            </button>
          </div>
        )}

        {mode === "pickup" ? (
          <section
            className="bg-white p-6 rounded border"
            aria-labelledby="pickup-heading"
          >
            <h2 id="pickup-heading" className="text-lg font-semibold mb-4">
              Pickup location
            </h2>
            {loading && (
              <p className="text-sm text-gray-500">Loading locations…</p>
            )}
            {!loading && (!pickupLocations || pickupLocations.length === 0) && (
              <p className="text-sm text-gray-700">
                No pickup locations available.
              </p>
            )}
            {!loading && pickupLocations && pickupLocations.length > 0 && (
              <ul className="space-y-2">
                {pickupLocations.map((l) => (
                  <li key={l.id}>
                    <label
                      htmlFor={`pl-${l.id}`}
                      className="flex items-start gap-3 border rounded p-3 hover:bg-gray-50 cursor-pointer"
                    >
                      <input
                        id={`pl-${l.id}`}
                        type="radio"
                        name="pickup"
                        checked={pickupId === l.id}
                        onChange={() => setPickupId(l.id)}
                        className="mt-1"
                      />
                      <span className="flex-1">
                        <span className="font-medium block">{l.name}</span>
                        {l.address && Object.keys(l.address).length > 0 && (
                          <span className="text-xs text-gray-500 block">
                            {[
                              l.address.line1,
                              l.address.city,
                              l.address.country,
                            ]
                              .filter(Boolean)
                              .join(", ")}
                          </span>
                        )}
                        {l.pickup_instructions && (
                          <span className="text-xs text-gray-600 mt-1 block">
                            {l.pickup_instructions}
                          </span>
                        )}
                      </span>
                      <span className="font-medium">Free</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : (
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
        )}

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
