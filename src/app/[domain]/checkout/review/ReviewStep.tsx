"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { StepIndicator } from "@/components/checkout/StepIndicator";
import {
  BackLink,
  CheckoutCard,
  ErrorBanner,
  Field,
  PrimaryButton,
  Textarea,
} from "@/components/checkout/ui";
import {
  clearCheckoutState,
  hasPaymentStep,
  readCheckoutState,
} from "@/lib/checkout-state";
import { useAttribution } from "@/components/layout/AttributionProvider";
import { getSessionFingerprint } from "@/lib/meta-pixel";
import type { CheckoutResponse } from "@/types/checkout";

/**
 * Step 4 — review + place order.
 *
 * The live order summary (items + totals breakdown + the coupon Apply
 * field) is shown by the checkout layout's sticky panel, so this step
 * focuses on confirming the shipping destination + collecting an order
 * note, then placing the order. The applied coupon is read back from
 * checkout-state (OrderSummary writes it there) and submitted with the order.
 *
 * On submit we POST the full payload to /api/checkout. The backend creates
 * the order and returns either a payment_url (redirect to gateway) or null
 * (COD / completed):
 *   - payment_url present → window.assign(payment_url)
 *   - else (COD / paid)  → /checkout/{order_id}/thank-you
 *
 * Cart line items live on the backend (Redis); the checkout endpoint
 * resolves them from the session cookie. We send the client list as a hint
 * but the server's cart takes precedence.
 */

interface CartLine {
  product_id: string;
  variant_id?: string | null;
  quantity: number;
  unit_price?: number;
  subtotal?: number;
  product_name?: string;
}

const T = {
  shipTo: { en: "Shipping to", ar: "التوصيل إلى" },
  notesCoupon: { en: "Order notes", ar: "ملاحظات الطلب" },
  orderNotes: { en: "Order notes (optional)", ar: "ملاحظات الطلب (اختياري)" },
  secure: {
    en: "Your data is fully protected and encrypted",
    ar: "بياناتك محمية ومشفّرة بالكامل",
  },
  backPayment: { en: "Back to payment", ar: "العودة للدفع" },
  place: { en: "Place order", ar: "تأكيد الطلب" },
  placing: { en: "Placing order…", ar: "جارٍ تأكيد الطلب…" },
  emptyCart: { en: "Your cart is empty.", ar: "سلة التسوق فارغة." },
  continueShopping: { en: "Continue shopping", ar: "متابعة التسوق" },
} as const;

export function ReviewStep() {
  const router = useRouter();
  const params = useParams() as { domain: string };
  const attribution = useAttribution();
  const [cart, setCart] = useState<{ items: CartLine[] } | null>(null);
  const [locale, setLocale] = useState("en");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  // COD-trust gate: true when the backend blocked COD for this buyer, so we
  // surface a "pay online instead" path rather than a dead-end error.
  const [codBlocked, setCodBlocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [state] = useState(() => readCheckoutState());

  const t = (k: keyof typeof T) => (locale === "ar" ? T[k].ar : T[k].en);

  useEffect(() => {
    if (!hasPaymentStep(state)) {
      router.replace(`/${params.domain}/checkout/payment`);
      return;
    }
    if (typeof document !== "undefined") {
      setLocale(document.documentElement.lang === "ar" ? "ar" : "en");
    }
    setNotes(state.customer_notes || "");

    (async () => {
      try {
        const res = await fetch("/api/cart", { cache: "no-store" });
        if (res.ok) {
          const body = await res.json();
          setCart((body?.data || body) as { items: CartLine[] });
        }
      } catch {
        /* swallow — review still renders without the line items */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function placeOrder(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCodBlocked(false);
    setSubmitting(true);

    // Build the CheckoutRequest payload from collected state. The whole
    // shipping_address is forwarded verbatim — including the Cluster 2
    // location fields (latitude/longitude/location_accuracy/
    // location_source/geocoded_address) when the customer pinned a
    // delivery location. The backend's OrderAddressRequest accepts them.
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
      saved_payment_method_id: state.saved_payment_method_id,
      customer_notes: notes || null,
      // Read the coupon from the LIVE state, not the mount snapshot — the
      // OrderSummary panel may have applied/removed one after this step
      // mounted (it writes coupon_code into checkout-state).
      coupon_code: readCheckoutState().coupon_code || null,
      gift_card_codes: state.gift_card_codes || [],
      ...(attribution ? { attribution } : {}),
      // Stable per-visitor id (same value ContactStep sends to /cart/track).
      // The backend links the order to its funnel events + abandoned-cart row
      // by this fingerprint, and the COD-trust / network-reputation path reads
      // it for journey context. Was previously DROPPED here — without it,
      // attribution funnel→order linkage and abandoned→order recovery degrade
      // to email/phone-only matching, and trust scoring loses session context.
      session_fingerprint: getSessionFingerprint() || null,
    };

    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        const detail = body?.detail;
        // COD-trust gate (403 cod_trust_blocked / 400 phone_required_for_cod):
        // the backend returns a localized message + prepaid fallbacks. Show the
        // friendly message and, for a hard block, surface a pay-online path —
        // never dump the raw error object on the buyer.
        if (detail && typeof detail === "object" && detail.code) {
          setError(
            (locale === "ar" ? detail.message_ar : detail.message_en) ||
              detail.message_en ||
              detail.message_ar ||
              `Checkout failed (${res.status})`,
          );
          setCodBlocked(detail.code === "cod_trust_blocked");
          setSubmitting(false);
          return;
        }
        const fallback =
          detail || body?.error || `Checkout failed (${res.status})`;
        setError(
          typeof fallback === "string" ? fallback : JSON.stringify(fallback),
        );
        setSubmitting(false);
        return;
      }
      const data = (body?.data || body) as CheckoutResponse;
      if (data.payment_url) {
        if (typeof window !== "undefined") {
          window.sessionStorage.setItem(
            "numu_checkout_pending_order",
            JSON.stringify({
              order_id: data.order_id,
              order_number: data.order_number,
            }),
          );
        }
        window.location.assign(data.payment_url);
        return;
      }
      clearCheckoutState();
      router.replace(
        `/${params.domain}/checkout/${data.order_id}/thank-you?n=${encodeURIComponent(data.order_number)}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  const a = state.shipping_address;
  const cartEmpty = cart !== null && cart.items.length === 0;

  return (
    <>
      <StepIndicator current="review" locale={locale} />
      <form onSubmit={placeOrder} className="space-y-5">
        {cartEmpty && (
          <ErrorBanner>
            {t("emptyCart")}{" "}
            <Link href={`/${params.domain}`} className="underline">
              {t("continueShopping")}
            </Link>
          </ErrorBanner>
        )}

        <CheckoutCard title={t("shipTo")}>
          <div className="text-sm leading-relaxed text-gray-700" dir="auto">
            <p className="font-medium text-gray-900">
              {a.first_name} {a.last_name}
            </p>
            <p>{a.line1}</p>
            {a.line2 && <p>{a.line2}</p>}
            <p>
              {a.city}
              {a.state ? `, ${a.state}` : ""}
              {a.postal_code ? ` ${a.postal_code}` : ""}
            </p>
            <p>{a.country}</p>
          </div>
          {a.geocoded_address && (
            <p className="mt-3 flex items-start gap-1.5 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="mt-0.5 shrink-0"
              >
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              <span dir="auto">{a.geocoded_address}</span>
            </p>
          )}
          <p className="mt-3 border-t border-gray-100 pt-3 text-sm text-gray-500">
            {state.shipping_method} · {state.email}
          </p>
        </CheckoutCard>

        <CheckoutCard title={t("notesCoupon")}>
          <Field label={t("orderNotes")} htmlFor="notes">
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={1000}
              rows={3}
              dir="auto"
            />
          </Field>
        </CheckoutCard>

        {error && <ErrorBanner>{error}</ErrorBanner>}
        {codBlocked && (
          <PrimaryButton
            type="button"
            onClick={() =>
              router.replace(`/${params.domain}/checkout/payment`)
            }
          >
            {locale === "ar"
              ? "ادفع أونلاين بدلاً من ذلك"
              : "Pay online instead"}
          </PrimaryButton>
        )}

        <p className="flex items-center justify-center gap-1.5 text-xs text-gray-500">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect width="18" height="11" x="3" y="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>{t("secure")}</span>
        </p>

        <div className="flex items-center justify-between gap-3">
          <BackLink href={`/${params.domain}/checkout/payment`}>
            {t("backPayment")}
          </BackLink>
          <PrimaryButton
            type="submit"
            disabled={submitting || cartEmpty || cart === null}
          >
            {submitting ? t("placing") : t("place")}
          </PrimaryButton>
        </div>
      </form>
    </>
  );
}
