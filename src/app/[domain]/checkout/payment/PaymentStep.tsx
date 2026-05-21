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
    patchCheckoutState({
      payment_method: method,
      cod_requested: codSelected,
      deposit_gateway: depositRequired ? depositGateway : null,
    });
    router.push(`/${params.domain}/checkout/review`);
  }

  const methods = config?.enabled_payment_methods || [];
  const showDepositPicker =
    method === "cod" && Boolean(config?.cod_deposit_policy?.enabled);

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
