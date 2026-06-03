"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { StepIndicator } from "@/components/checkout/StepIndicator";
import {
  BackLink,
  CheckoutCard,
  ErrorBanner,
  OptionRow,
  PrimaryButton,
  cn,
} from "@/components/checkout/ui";
import {
  hasContactStep,
  patchCheckoutState,
  readCheckoutState,
} from "@/lib/checkout-state";
import type { ShippingRateOption } from "@/types/checkout";

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
 * Posts the resolved address to /api/shipping/options; backend returns the
 * rates valid for that zone. Customer picks one and we save the rate ID (the
 * server re-resolves it on POST /checkout to prevent amount tampering).
 */

const T = {
  fulfillment: { en: "Fulfillment method", ar: "طريقة الاستلام" },
  ship: { en: "Ship", ar: "توصيل" },
  pickup: { en: "Pick up in store", ar: "استلام من المتجر" },
  pickupTitle: { en: "Pickup location", ar: "مكان الاستلام" },
  loadingLocations: { en: "Loading locations…", ar: "جارٍ تحميل الأماكن…" },
  noPickup: {
    en: "No pickup locations available.",
    ar: "لا توجد أماكن استلام متاحة.",
  },
  free: { en: "Free", ar: "مجاناً" },
  shipMethod: { en: "Shipping method", ar: "طريقة الشحن" },
  loadingShip: {
    en: "Loading shipping options…",
    ar: "جارٍ تحميل خيارات الشحن…",
  },
  noRates: {
    en: "No shipping options available for this address.",
    ar: "لا توجد خيارات شحن متاحة لهذا العنوان.",
  },
  editAddress: { en: "Edit address", ar: "تعديل العنوان" },
  days: { en: "business days", ar: "أيام عمل" },
  pickRate: { en: "Pick a shipping option to continue.", ar: "اختر طريقة شحن للمتابعة." },
  pickPickup: {
    en: "Pick a pickup location to continue.",
    ar: "اختر مكان استلام للمتابعة.",
  },
  loadFail: {
    en: "Couldn't load shipping options. Please try again.",
    ar: "تعذّر تحميل خيارات الشحن. حاول مرة أخرى.",
  },
  back: { en: "Back to contact", ar: "العودة للبيانات" },
  continue: { en: "Continue to payment", ar: "متابعة إلى الدفع" },
} as const;

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
  const [locale, setLocale] = useState("en");

  const t = (k: keyof typeof T) => (locale === "ar" ? T[k].ar : T[k].en);

  function formatCurrency(cents: number, currency: string) {
    try {
      return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en", {
        style: "currency",
        currency,
      }).format(cents / 100);
    } catch {
      return `${(cents / 100).toFixed(2)} ${currency}`;
    }
  }

  useEffect(() => {
    if (typeof document !== "undefined") {
      setLocale(document.documentElement.lang === "ar" ? "ar" : "en");
    }
    const s = readCheckoutState();
    if (!hasContactStep(s)) {
      router.replace(`/${params.domain}/checkout`);
      return;
    }
    setSelected(s.selected_shipping_rate_id);
    setPickupId(s.pickup_location_id);
    setMode(s.pickup_location_id ? "pickup" : "ship");
    (async () => {
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

        if (!ratesRes.ok) {
          if (ratesRes.status === 404) {
            setRates([]);
          } else {
            setError(t("loadFail"));
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
        setError(t("pickRate"));
        return;
      }
      const rate = rates?.find((r) => r.id === selected);
      patchCheckoutState({
        selected_shipping_rate_id: selected,
        shipping_method: rate?.name || null,
        pickup_location_id: null,
      });
    } else {
      if (!pickupId) {
        setError(t("pickPickup"));
        return;
      }
      const loc = pickupLocations?.find((p) => p.id === pickupId);
      patchCheckoutState({
        pickup_location_id: pickupId,
        selected_shipping_rate_id: null,
        shipping_method: loc?.name ? `Pickup at ${loc.name}` : "Pickup",
      });
    }
    router.push(`/${params.domain}/checkout/payment`);
  }

  const showPickupTab = (pickupLocations?.length ?? 0) > 0;

  return (
    <>
      <StepIndicator current="shipping" locale={locale} />
      <form onSubmit={submit} className="space-y-5">
        {showPickupTab && (
          <div
            role="tablist"
            aria-label={t("fulfillment")}
            className="inline-flex rounded-xl border border-gray-200 bg-white p-1 shadow-sm"
          >
            {(["ship", "pickup"] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={cn(
                  "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  mode === m
                    ? "bg-gray-900 text-white"
                    : "text-gray-600 hover:bg-gray-50",
                )}
              >
                {m === "ship" ? t("ship") : t("pickup")}
              </button>
            ))}
          </div>
        )}

        {mode === "pickup" ? (
          <CheckoutCard title={t("pickupTitle")} aria-labelledby="pickup-heading">
            {loading && (
              <p className="text-sm text-gray-500">{t("loadingLocations")}</p>
            )}
            {!loading && (!pickupLocations || pickupLocations.length === 0) && (
              <p className="text-sm text-gray-700">{t("noPickup")}</p>
            )}
            {!loading && pickupLocations && pickupLocations.length > 0 && (
              <ul className="space-y-2.5">
                {pickupLocations.map((l) => (
                  <li key={l.id}>
                    <OptionRow
                      htmlFor={`pl-${l.id}`}
                      selected={pickupId === l.id}
                    >
                      <input
                        id={`pl-${l.id}`}
                        type="radio"
                        name="pickup"
                        checked={pickupId === l.id}
                        onChange={() => setPickupId(l.id)}
                        className="mt-1 h-4 w-4 accent-gray-900"
                      />
                      <span className="flex-1">
                        <span className="block font-medium text-gray-900">
                          {locale === "ar" && l.name_ar ? l.name_ar : l.name}
                        </span>
                        {l.address && Object.keys(l.address).length > 0 && (
                          <span className="block text-xs text-gray-500">
                            {[l.address.line1, l.address.city, l.address.country]
                              .filter(Boolean)
                              .join(", ")}
                          </span>
                        )}
                        {(locale === "ar"
                          ? l.pickup_instructions_ar
                          : l.pickup_instructions) && (
                          <span className="mt-1 block text-xs text-gray-600">
                            {locale === "ar"
                              ? l.pickup_instructions_ar
                              : l.pickup_instructions}
                          </span>
                        )}
                      </span>
                      <span className="font-medium text-gray-900">
                        {t("free")}
                      </span>
                    </OptionRow>
                  </li>
                ))}
              </ul>
            )}
          </CheckoutCard>
        ) : (
          <CheckoutCard title={t("shipMethod")} aria-labelledby="ship-heading">
            {loading && (
              <p className="text-sm text-gray-500">{t("loadingShip")}</p>
            )}
            {!loading && rates && rates.length === 0 && (
              <p className="text-sm text-gray-700">
                {t("noRates")}{" "}
                <Link
                  href={`/${params.domain}/checkout`}
                  className="font-medium text-gray-900 underline underline-offset-2"
                >
                  {t("editAddress")}
                </Link>
              </p>
            )}
            {!loading && rates && rates.length > 0 && (
              <ul className="space-y-2.5">
                {rates.map((r) => (
                  <li key={r.id}>
                    <OptionRow htmlFor={`rate-${r.id}`} selected={selected === r.id}>
                      <input
                        id={`rate-${r.id}`}
                        type="radio"
                        name="rate"
                        checked={selected === r.id}
                        onChange={() => setSelected(r.id)}
                        className="h-4 w-4 accent-gray-900"
                      />
                      <span className="flex-1">
                        <span className="block font-medium text-gray-900">
                          {r.name}
                        </span>
                        {(r.estimated_days_min || r.estimated_days_max) && (
                          <span className="text-xs text-gray-500">
                            {r.estimated_days_min ?? "?"}–
                            {r.estimated_days_max ?? "?"} {t("days")}
                            {r.carrier ? ` · ${r.carrier}` : ""}
                          </span>
                        )}
                      </span>
                      <span className="font-medium text-gray-900">
                        {formatCurrency(r.amount_cents, r.currency)}
                      </span>
                    </OptionRow>
                  </li>
                ))}
              </ul>
            )}
          </CheckoutCard>
        )}

        {error && <ErrorBanner>{error}</ErrorBanner>}

        <div className="flex items-center justify-between gap-3">
          <BackLink href={`/${params.domain}/checkout`}>{t("back")}</BackLink>
          <PrimaryButton
            type="submit"
            disabled={mode === "ship" ? !selected : !pickupId}
          >
            {t("continue")}
          </PrimaryButton>
        </div>
      </form>
    </>
  );
}
