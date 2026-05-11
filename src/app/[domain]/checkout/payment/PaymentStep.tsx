"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { StepIndicator } from "@/components/checkout/StepIndicator";
import {
  hasShippingStep,
  patchCheckoutState,
  readCheckoutState,
} from "@/lib/checkout-state";

/**
 * Step 3 — payment method picker.
 *
 * Only displays methods the merchant has enabled. We read the
 * checkout config from /api/storefront/checkout-config to know which
 * gateways are live (Paymob / Kashier / Fawry / Fawaterak / InstaPay
 * / COD). COD picks an extra "deposit gateway" sub-form when the
 * store's deposit policy is active.
 *
 * Picking the method here doesn't commit anything — only the review
 * step posts /api/checkout. Returning here from review preserves the
 * choice via sessionStorage.
 */

interface CheckoutConfig {
  enabled_payment_methods: string[];
  cod_deposit_policy?: { enabled?: boolean; allowed_gateways?: string[] };
}

interface SavedCard {
  id: string;
  gateway: string;
  display_name: string | null;
  card_brand: string | null;
  last_four: string | null;
}

// Gateway codes whose saved cards we can charge token-only. Other
// methods (Fawry/Fawaterak/InstaPay/COD) don't have re-chargeable
// tokens — saved cards are skipped for them entirely.
const SAVED_CARD_GATEWAYS = new Set(["paymob", "paymob_card", "kashier"]);

const METHOD_LABELS: Record<string, string> = {
  paymob: "Credit / debit card (Paymob)",
  paymob_card: "Credit / debit card (Paymob)",
  kashier: "Credit / debit card (Kashier)",
  fawry: "Fawry",
  fawaterak: "Fawaterak",
  instapay: "InstaPay",
  cod: "Cash on Delivery",
};

export function PaymentStep() {
  const router = useRouter();
  const params = useParams() as { domain: string };
  const [config, setConfig] = useState<CheckoutConfig | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [depositGateway, setDepositGateway] = useState<string | null>(null);
  const [savedCards, setSavedCards] = useState<SavedCard[] | null>(null);
  const [savedCardId, setSavedCardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const s = readCheckoutState();
    if (!hasShippingStep(s)) {
      router.replace(`/${params.domain}/checkout/shipping`);
      return;
    }
    setMethod(s.payment_method);
    setDepositGateway(s.deposit_gateway);
    setSavedCardId(
      (s as unknown as { saved_payment_method_id?: string | null })
        .saved_payment_method_id || null,
    );

    (async () => {
      try {
        const res = await fetch("/api/storefront/checkout-config", {
          cache: "no-store",
        });
        if (res.ok) {
          const body = await res.json();
          setConfig((body?.data || body) as CheckoutConfig);
        } else {
          // Backend without the config endpoint → fall back to a
          // sensible default list. Keeps checkout usable on dev
          // stacks that haven't deployed the config route yet.
          setConfig({ enabled_payment_methods: ["paymob", "cod"] });
        }
      } catch {
        setConfig({ enabled_payment_methods: ["paymob", "cod"] });
      } finally {
        setLoading(false);
      }

      // Phase 7.5 — load the customer's saved cards. Anonymous
      // visitors get 401 here → we silently render the new-card flow
      // only. The store_id query param is required by the backend
      // for the per-store scope check; we resolve it via the store
      // lookup hidden in the API proxy chain.
      try {
        const storeRes = await fetch("/api/storefront/store", {
          cache: "no-store",
        }).catch(() => null);
        let storeId: string | null = null;
        if (storeRes?.ok) {
          const body = await storeRes.json();
          storeId = (body?.data?.id || body?.id || null) as string | null;
        }
        if (storeId) {
          const cardsRes = await fetch(
            `/api/customer/saved-cards?store_id=${encodeURIComponent(storeId)}`,
            { cache: "no-store" },
          );
          if (cardsRes.ok) {
            const body = await cardsRes.json();
            const list = (body?.data || body || []) as SavedCard[];
            setSavedCards(Array.isArray(list) ? list : []);
          }
        }
      } catch {
        /* swallow — saved cards are optional UX */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!method) {
      setError("Pick a payment method to continue.");
      return;
    }
    const codSelected = method === "cod";
    const depositRequired =
      codSelected && Boolean(config?.cod_deposit_policy?.enabled);
    if (depositRequired && !depositGateway) {
      setError("Pick a gateway for the COD deposit payment.");
      return;
    }
    // Only forward the saved card when it actually matches the
    // chosen gateway — picking a saved Paymob card then switching to
    // Fawry must clear the saved-card binding so the backend doesn't
    // 400 on the gateway mismatch.
    const savedCardForMethod = savedCards?.find(
      (c) =>
        c.id === savedCardId &&
        (c.gateway === method ||
          (c.gateway === "paymob" && method === "paymob_card")),
    );
    patchCheckoutState({
      payment_method: method,
      cod_requested: codSelected,
      deposit_gateway: depositRequired ? depositGateway : null,
      ...({
        saved_payment_method_id: savedCardForMethod?.id || null,
      } as unknown as Record<string, never>),
    });
    router.push(`/${params.domain}/checkout/review`);
  }

  const methods = config?.enabled_payment_methods || [];
  const showDepositPicker =
    method === "cod" && Boolean(config?.cod_deposit_policy?.enabled);
  // Saved cards are only meaningful when:
  //   1. The customer is logged in (savedCards is non-null)
  //   2. The selected method is a token-charge-capable gateway
  //   3. The customer has at least one saved card for that gateway
  const savedCardsForMethod = (savedCards || []).filter(
    (c) =>
      method &&
      SAVED_CARD_GATEWAYS.has(method) &&
      (c.gateway === method ||
        (c.gateway === "paymob" && method === "paymob_card")),
  );

  return (
    <>
      <StepIndicator current="payment" />
      <form onSubmit={submit} className="space-y-6">
        <section className="bg-white p-6 rounded border">
          <h2 className="text-lg font-semibold mb-4">Payment</h2>
          {loading && (
            <p className="text-sm text-gray-500">Loading payment options…</p>
          )}
          {!loading && methods.length === 0 && (
            <p className="text-sm text-red-700">
              No payment methods configured for this store.
            </p>
          )}
          {!loading && methods.length > 0 && (
            <ul className="space-y-2">
              {methods.map((m) => (
                <li key={m}>
                  <label
                    htmlFor={`m-${m}`}
                    className="flex items-center gap-3 border rounded p-3 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      id={`m-${m}`}
                      type="radio"
                      name="payment"
                      checked={method === m}
                      onChange={() => setMethod(m)}
                    />
                    <span className="font-medium">
                      {METHOD_LABELS[m] || m}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        {savedCardsForMethod.length > 0 && (
          <section className="bg-white p-6 rounded border">
            <h2 className="text-lg font-semibold mb-2">Saved cards</h2>
            <p className="text-sm text-gray-600 mb-3">
              Pay faster with a card on file, or pick "Enter a new card" to
              add another.
            </p>
            <ul className="space-y-2">
              <li>
                <label className="flex items-center gap-3 border rounded p-3 cursor-pointer hover:bg-gray-50">
                  <input
                    type="radio"
                    name="saved-card"
                    checked={savedCardId === null}
                    onChange={() => setSavedCardId(null)}
                  />
                  <span className="text-sm">Enter a new card</span>
                </label>
              </li>
              {savedCardsForMethod.map((c) => (
                <li key={c.id}>
                  <label className="flex items-center gap-3 border rounded p-3 cursor-pointer hover:bg-gray-50">
                    <input
                      type="radio"
                      name="saved-card"
                      checked={savedCardId === c.id}
                      onChange={() => setSavedCardId(c.id)}
                    />
                    <span className="text-sm">
                      {c.display_name ||
                        `${c.card_brand || "Card"} •••• ${c.last_four || "????"}`}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        )}

        {showDepositPicker && (
          <section className="bg-white p-6 rounded border">
            <h2 className="text-lg font-semibold mb-2">COD deposit</h2>
            <p className="text-sm text-gray-600 mb-3">
              This store requires a small upfront deposit for COD orders. Pick
              the gateway to charge:
            </p>
            <select
              required
              value={depositGateway || ""}
              onChange={(e) => setDepositGateway(e.target.value)}
              className="border rounded px-3 py-2 bg-white"
            >
              <option value="">— pick gateway —</option>
              {(config?.cod_deposit_policy?.allowed_gateways || []).map((g) => (
                <option key={g} value={g}>
                  {METHOD_LABELS[g] || g}
                </option>
              ))}
            </select>
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
            href={`/${params.domain}/checkout/shipping`}
            className="text-sm underline text-gray-700"
          >
            ‹ Back to shipping
          </Link>
          <button
            type="submit"
            className="bg-gray-900 text-white px-6 py-2 rounded hover:bg-gray-800 disabled:opacity-50"
          >
            Review order
          </button>
        </div>
      </form>
    </>
  );
}
