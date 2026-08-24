"use client";

import { useEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/money";
import {
  CheckoutCard,
  ErrorBanner,
  OptionRow,
  PrimaryButton,
} from "@/components/checkout/ui";

interface PayLineItem {
  product_name: string;
  quantity: number;
  total: number;
}

interface PayOrderView {
  order_id: string;
  order_number: string;
  status: string;
  payment_status: string;
  currency: string;
  total: number;
  amount_due: number;
  is_payable: boolean;
  not_payable_reason: string | null;
  recovery_promo: string | null;
  line_items: PayLineItem[];
  enabled_payment_methods: string[];
  /** Manual transfer rails (instapay / vodafone_cash). Optional: older API. */
  manual_methods?: string[];
  subtotal?: number;
  shipping_cost?: number;
  discount_amount?: number;
  store_name: string;
}

const T = {
  title: { en: "Complete your payment", ar: "أكمل الدفع" },
  loading: { en: "Loading…", ar: "جارٍ التحميل…" },
  notFound: { en: "We couldn't find this order.", ar: "تعذّر العثور على هذا الطلب." },
  alreadyPaid: {
    en: "This order is already paid — nothing to do. Thank you!",
    ar: "تم دفع هذا الطلب بالفعل — لا حاجة لأي إجراء. شكراً لك!",
  },
  closed: {
    en: "This order can no longer be paid online.",
    ar: "لم يعد بالإمكان دفع هذا الطلب أونلاين.",
  },
  order: { en: "Order", ar: "طلب" },
  amountDue: { en: "Amount due", ar: "المبلغ المستحق" },
  choose: { en: "Choose a payment method", ar: "اختر طريقة الدفع" },
  noMethods: {
    en: "Online payment isn't available for this store right now.",
    ar: "الدفع الأونلاين غير متاح لهذا المتجر حالياً.",
  },
  pay: { en: "Pay now", ar: "ادفع الآن" },
  processing: { en: "Processing…", ar: "جارٍ المعالجة…" },
  selectFirst: { en: "Select a payment method first.", ar: "اختر طريقة دفع أولاً." },
} as const;

const METHOD_LABEL: Record<string, { en: string; ar: string }> = {
  paymob: { en: "Card or mobile wallet", ar: "بطاقة أو محفظة إلكترونية" },
  kashier: { en: "Card", ar: "بطاقة بنكية" },
  instapay: { en: "InstaPay transfer", ar: "تحويل إنستاباي" },
  vodafone_cash: { en: "Vodafone Cash", ar: "فودافون كاش" },
};

/** Where the proof-upload resume flow lives for each manual rail. */
const MANUAL_RESUME_PATH: Record<string, string> = {
  instapay: "instapay",
  vodafone_cash: "vodafone-cash",
};

export function PayRecovery({ orderId }: { orderId: string }) {
  const [view, setView] = useState<PayOrderView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Stable across retries. This route triggers a PAYMENT on an existing
  // order, so a per-attempt key risks charging the shopper twice — the same
  // defect as checkout, with worse consequences.
  // Lazily initialised ONCE — `useRef(crypto.randomUUID())` would re-evaluate
  // the argument on every render (discarding a UUID per keystroke, and calling
  // it on the SSR path); a ref keeps it out of the render cycle entirely.
  const idempotencyKeyRef = useRef<string>("");
  if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
  const [locale, setLocale] = useState<"en" | "ar">("en");

  const isAr = locale === "ar";
  const t = (k: keyof typeof T) => T[k][locale];

  useEffect(() => {
    if (typeof document !== "undefined") {
      setLocale(document.documentElement.lang === "ar" ? "ar" : "en");
    }
    (async () => {
      try {
        const res = await fetch(`/api/pay/${orderId}`, { cache: "no-store" });
        if (!res.ok) {
          setLoadError(T.notFound[isAr ? "ar" : "en"]);
          return;
        }
        const body = await res.json();
        const data = (body?.data || body) as PayOrderView;
        setView(data);
        // Preselect the first available method for a one-tap flow.
        const first =
          data.enabled_payment_methods?.[0] ?? data.manual_methods?.[0] ?? null;
        if (first) setMethod(first);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function pay() {
    if (!method) {
      setError(t("selectFirst"));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/pay/${orderId}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKeyRef.current,
        },
        body: JSON.stringify({ payment_method: method }),
      });
      const body = await res.json();
      if (!res.ok) {
        const detail = body?.detail || body?.error;
        setError(
          typeof detail === "string"
            ? detail
            : isAr
              ? "تعذّر بدء الدفع. حاول مرة أخرى."
              : "Couldn't start the payment. Please try again.",
        );
        setSubmitting(false);
        return;
      }
      const data = body?.data || body;
      // Manual transfer rail: the API returned transfer instructions with a
      // reference code — hand over to the dedicated resume page, which shows
      // the destination and takes the proof upload.
      if (data.type === "manual" && data.reference_code) {
        const path = MANUAL_RESUME_PATH[data.method] || "instapay";
        window.location.assign(
          `/${path}/${orderId}?ref=${encodeURIComponent(data.reference_code)}`,
        );
        return;
      }
      if (data.payment_url) {
        window.location.assign(data.payment_url);
        return;
      }
      if (data.session_url) {
        window.location.assign(data.session_url);
        return;
      }
      setError(
        isAr ? "تعذّر بدء الدفع. حاول مرة أخرى." : "Couldn't start the payment.",
      );
      setSubmitting(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  if (loadError) {
    return <ErrorBanner>{loadError}</ErrorBanner>;
  }
  if (!view) {
    return <p className="text-center text-sm text-gray-500">{t("loading")}</p>;
  }

  if (!view.is_payable) {
    const msg =
      view.not_payable_reason === "already_paid" ? t("alreadyPaid") : t("closed");
    return (
      <CheckoutCard title={`${t("order")} ${view.order_number}`}>
        <p className="text-sm text-gray-700">{msg}</p>
      </CheckoutCard>
    );
  }

  const allMethods = [
    ...(view.enabled_payment_methods ?? []),
    ...(view.manual_methods ?? []),
  ];
  const noMethods = allMethods.length === 0;

  return (
    <div className="space-y-5" dir={isAr ? "rtl" : "ltr"}>
      <h1 className="text-xl font-semibold">{t("title")}</h1>

      <CheckoutCard title={`${t("order")} ${view.order_number}`}>
        <ul className="space-y-1.5 text-sm text-gray-600">
          {view.line_items.map((li, i) => (
            <li key={i} className="flex justify-between gap-3">
              <span>
                {li.product_name} × {li.quantity}
              </span>
              <span>{formatCents(li.total, view.currency)}</span>
            </li>
          ))}
        </ul>
        {(view.shipping_cost ?? 0) > 0 && (
          <div className="mt-3 space-y-1 border-t pt-3 text-sm text-gray-600">
            <div className="flex justify-between gap-3">
              <span>{isAr ? "المنتجات" : "Items"}</span>
              <span>{formatCents(view.subtotal ?? 0, view.currency)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span>{isAr ? "الشحن" : "Shipping"}</span>
              <span>{formatCents(view.shipping_cost ?? 0, view.currency)}</span>
            </div>
            {(view.discount_amount ?? 0) > 0 && (
              <div className="flex justify-between gap-3">
                <span>{isAr ? "الخصم" : "Discount"}</span>
                <span>− {formatCents(view.discount_amount ?? 0, view.currency)}</span>
              </div>
            )}
          </div>
        )}
        <div className="mt-3 flex justify-between border-t pt-3 text-base font-semibold">
          <span>{t("amountDue")}</span>
          <span>{formatCents(view.amount_due, view.currency)}</span>
        </div>
        {view.recovery_promo && (
          <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
            {view.recovery_promo}
          </p>
        )}
      </CheckoutCard>

      <CheckoutCard title={t("choose")}>
        {noMethods ? (
          <p className="text-sm text-gray-500">{t("noMethods")}</p>
        ) : (
          <ul className="space-y-2.5">
            {allMethods.map((m) => {
              const label = METHOD_LABEL[m]?.[locale] || m;
              return (
                <li key={m}>
                  <OptionRow htmlFor={`pm-${m}`} selected={method === m}>
                    <input
                      id={`pm-${m}`}
                      type="radio"
                      name="pay-method"
                      className="h-4 w-4"
                      checked={method === m}
                      onChange={() => setMethod(m)}
                    />
                    <span className="text-sm">{label}</span>
                  </OptionRow>
                </li>
              );
            })}
          </ul>
        )}
      </CheckoutCard>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {!noMethods && (
        <PrimaryButton
          type="button"
          onClick={pay}
          disabled={submitting || !method}
          className="w-full"
        >
          {submitting ? t("processing") : t("pay")}
        </PrimaryButton>
      )}
    </div>
  );
}
