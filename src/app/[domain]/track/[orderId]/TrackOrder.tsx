"use client";

/**
 * Public order-tracking page — guest-accessible, no auth. Fetches the sanitised
 * public tracking view (`/api/storefront/track/{orderId}` → FastAPI
 * `/storefront/track/{order_id}`) and renders the status timeline, items and
 * totals. Reached from the confirmation email / WhatsApp link by anyone holding
 * the (unguessable) order id. Bilingual (en + Egyptian Arabic), RTL-safe.
 */

import { useEffect, useState } from "react";
import { formatCents } from "@/lib/money";

interface Line {
  product_name: string;
  quantity: number;
  unit_price: number;
  total: number;
  product_image_url?: string | null;
}
interface Timeline {
  placed_at?: string | null;
  paid_at?: string | null;
  fulfilled_at?: string | null;
  shipped_at?: string | null;
  delivered_at?: string | null;
  cancelled_at?: string | null;
}
interface Tracking {
  order_id: string;
  order_number: string;
  status: string;
  payment_status: string;
  fulfillment_status: string;
  currency: string;
  subtotal: number;
  shipping_cost: number;
  tax_amount: number;
  discount_amount: number;
  total: number;
  customer_name?: string | null;
  shipping_address?: { city?: string | null; governorate?: string | null; country?: string | null };
  line_items: Line[];
  tracking_number?: string | null;
  tracking_url?: string | null;
  shipping_method?: string | null;
  timeline: Timeline;
  store: { name: string; logo_url?: string | null };
}

const STATUS_IDX: Record<string, number> = {
  pending: 0, placed: 0, paid: 1, confirmed: 1, processing: 1,
  shipped: 2, out_for_delivery: 2, delivered: 3, completed: 3,
};

export function TrackOrder({ orderId, domain }: { orderId: string; domain: string }) {
  const [data, setData] = useState<Tracking | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "notfound">("loading");
  const [isAr, setIsAr] = useState(false);
  const T = (en: string, ar: string) => (isAr ? ar : en);

  useEffect(() => {
    if (typeof document !== "undefined")
      setIsAr(document.documentElement.lang === "ar");
    (async () => {
      try {
        const res = await fetch(`/api/storefront/track/${orderId}`, { cache: "no-store" });
        if (!res.ok) return setState("notfound");
        const body = await res.json();
        setData((body?.data || body) as Tracking);
        setState("ok");
      } catch {
        setState("notfound");
      }
    })();
  }, [orderId]);

  const fmt = (c?: number) => (c == null ? "" : formatCents(c, data?.currency || "EGP"));

  const dir = isAr ? "rtl" : "ltr";

  if (state === "loading") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center text-gray-500" dir={dir}>
        {T("Loading your order…", "جارٍ تحميل طلبك…")}
      </div>
    );
  }
  if (state === "notfound" || !data) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center" dir={dir}>
        <h1 className="text-xl font-semibold text-gray-900">
          {T("Order not found", "الطلب غير موجود")}
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          {T(
            "Check the link in your confirmation email or WhatsApp message.",
            "راجع اللينك في إيميل التأكيد أو رسالة واتساب.",
          )}
        </p>
      </div>
    );
  }

  const cancelled = data.status.toLowerCase() === "cancelled";
  const current = STATUS_IDX[data.status.toLowerCase()] ?? 0;
  const steps = [
    { en: "Placed", ar: "تم الطلب", at: data.timeline.placed_at },
    { en: "Confirmed", ar: "تم التأكيد", at: data.timeline.paid_at || data.timeline.fulfilled_at },
    { en: "Shipped", ar: "تم الشحن", at: data.timeline.shipped_at },
    { en: "Delivered", ar: "تم التوصيل", at: data.timeline.delivered_at },
  ];
  const fmtDate = (s?: string | null) =>
    s ? new Date(s).toLocaleDateString(isAr ? "ar-EG" : "en-GB", { day: "numeric", month: "short" }) : "";

  const place = [data.shipping_address?.city, data.shipping_address?.governorate, data.shipping_address?.country]
    .filter(Boolean)
    .join("، ");

  return (
    <div className="min-h-screen bg-gray-50" dir={dir}>
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        {/* Store header */}
        <div className="mb-6 flex items-center gap-3">
          {data.store.logo_url ? (
            <img src={data.store.logo_url} alt={data.store.name} className="h-9 w-9 rounded-lg object-contain" />
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-900 text-sm font-bold text-white">
              {data.store.name?.[0] || "·"}
            </span>
          )}
          <span className="text-sm font-semibold uppercase tracking-wide text-gray-900">
            {data.store.name}
          </span>
        </div>

        {/* Status card */}
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-400">{T("Order", "الطلب")}</p>
              <p className="font-mono text-lg font-semibold text-gray-900" dir="ltr">{data.order_number}</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${cancelled ? "bg-red-50 text-red-600" : "bg-gray-900 text-white"}`}>
              {cancelled
                ? T("Cancelled", "ملغي")
                : [T("Placed", "تم الطلب"), T("Confirmed", "تم التأكيد"), T("Shipped", "تم الشحن"), T("Delivered", "تم التوصيل")][current]}
            </span>
          </div>

          {!cancelled && (
            <ol className="mt-7 flex items-start">
              {steps.map((s, i) => {
                const done = i <= current;
                const isCurrent = i === current;
                return (
                  <li key={i} className="relative flex flex-1 flex-col items-center">
                    {i < steps.length - 1 && (
                      <span
                        aria-hidden
                        className={`absolute top-[15px] h-[3px] w-full rounded-full ltr:left-1/2 rtl:right-1/2 ${i < current ? "bg-gray-900" : "bg-gray-200"}`}
                      />
                    )}
                    <span
                      className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold ${
                        done ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-400"
                      } ${isCurrent ? "ring-4 ring-gray-900/10" : ""}`}
                    >
                      {done ? (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      ) : (
                        i + 1
                      )}
                    </span>
                    <span className={`mt-3 text-center text-[11px] font-medium ${done ? "text-gray-900" : "text-gray-400"}`}>
                      {T(s.en, s.ar)}
                    </span>
                    {s.at && <span className="text-[10px] text-gray-400">{fmtDate(s.at)}</span>}
                  </li>
                );
              })}
            </ol>
          )}

          {data.tracking_number && (
            <div className="mt-6 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
              <span className="text-gray-500">
                {T("Tracking number", "رقم التتبّع")}
                {data.shipping_method ? ` · ${data.shipping_method}` : ""}
              </span>
              <span className="flex items-center gap-3">
                <span className="font-mono font-semibold text-gray-900" dir="ltr">{data.tracking_number}</span>
                {data.tracking_url && (
                  <a href={data.tracking_url} target="_blank" rel="noopener noreferrer" className="font-semibold text-gray-900 underline">
                    {T("Track", "تتبّع")}
                  </a>
                )}
              </span>
            </div>
          )}
        </section>

        {/* Items + totals */}
        {data.line_items.length > 0 && (
          <section className="mt-5 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-3 text-base font-semibold text-gray-900">{T("Items", "المنتجات")}</h2>
            <ul className="divide-y divide-gray-100">
              {data.line_items.map((l, i) => (
                <li key={i} className="flex items-center gap-3 py-3">
                  <span className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-gray-100">
                    {l.product_image_url && (
                      <img src={l.product_image_url} alt="" className="h-full w-full object-cover" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="block truncate font-medium text-gray-900">{l.product_name}</span>
                    <span className="text-gray-400">× {l.quantity}</span>
                  </span>
                  <span className="shrink-0 text-sm font-medium text-gray-900">{fmt(l.total)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 space-y-1.5 border-t border-gray-100 pt-4 text-sm">
              <Row label={T("Subtotal", "الإجمالي الفرعي")} value={fmt(data.subtotal)} />
              {data.discount_amount > 0 && (
                <Row label={T("Discount", "الخصم")} value={`−${fmt(data.discount_amount)}`} good />
              )}
              <Row
                label={T("Shipping", "الشحن")}
                value={data.shipping_cost === 0 ? T("Free", "مجاناً") : fmt(data.shipping_cost)}
              />
              {data.tax_amount > 0 && <Row label={T("Tax", "الضريبة")} value={fmt(data.tax_amount)} />}
              <div className="flex items-center justify-between border-t border-gray-100 pt-2 text-base font-semibold text-gray-900">
                <span>{T("Total", "الإجمالي")}</span>
                <span>{fmt(data.total)}</span>
              </div>
            </div>
            {place && (
              <p className="mt-4 border-t border-gray-100 pt-3 text-sm text-gray-500" dir="auto">
                {T("Delivering to", "التوصيل إلى")}: {place}
              </p>
            )}
          </section>
        )}

        <div className="mt-6 text-center">
          <a href={`/${domain}`} className="text-sm font-semibold text-gray-900 underline underline-offset-4">
            {T("Continue shopping", "متابعة التسوق")}
          </a>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={good ? "font-medium text-emerald-700" : "font-medium text-gray-900"}>{value}</span>
    </div>
  );
}
