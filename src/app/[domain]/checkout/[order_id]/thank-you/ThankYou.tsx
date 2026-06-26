"use client";

/**
 * Built-in order-confirmation ("thank you") page.
 *
 * Renders the placed order: line items, delivery address, the full totals
 * breakdown (subtotal / discount / automatic offers / shipping / tax /
 * total), the applied coupon, and any automatic promotions — sourced from
 * the order detail (`GET /api/customer/me/orders/{id}` →
 * `storefront/me/orders/{id}`, which returns all of these as int cents).
 *
 * The page may also receive a server-prefetched `initialOrder` (threaded
 * from the route's `resolveByotFork` ctx) so the confirmation renders
 * without a client round-trip; we still re-fetch in the background to fill
 * any gaps. When neither the prefetch nor the fetch yields an order (a
 * guest whose session cookie doesn't carry it), we degrade gracefully to a
 * "your order N has been placed" message rather than an error.
 *
 * Bilingual (en + Egyptian Arabic), RTL-safe via logical spacing.
 */

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { formatCents as formatCentsMoney } from "@/lib/money";

interface OrderLine {
  product_id: string;
  product_name?: string;
  variant_name?: string | null;
  quantity: number;
  unit_price?: number;
  total_price?: number;
  // Tolerate the older `subtotal` per-line name too.
  subtotal?: number;
  image_url?: string | null;
}

interface AppliedPromotion {
  id?: string;
  title?: string;
  title_ar?: string;
  amount: number; // cents
}

interface OrderAddress {
  first_name?: string;
  last_name?: string;
  full_name?: string;
  address_line1?: string;
  address_line2?: string | null;
  city?: string;
  state?: string | null;
  postal_code?: string | null;
  country?: string;
  phone?: string | null;
}

interface Order {
  id: string;
  order_number?: string;
  status?: string;
  payment_status?: string;
  payment_method?: string | null;
  shipping_method?: string | null;
  subtotal?: number;
  shipping_cost?: number;
  tax_amount?: number;
  discount_amount?: number;
  coupon_code?: string | null;
  applied_promotions?: AppliedPromotion[];
  total?: number;
  currency?: string;
  email?: string;
  // The detail endpoint names the lines `line_items`; tolerate `items` too.
  line_items?: OrderLine[];
  items?: OrderLine[];
  shipping_address?: OrderAddress;
}

function fmt(cents?: number, currency = "EGP") {
  if (cents == null) return "";
  return formatCentsMoney(cents, currency);
}

function lineAmount(l: OrderLine): number | undefined {
  return l.total_price ?? l.subtotal;
}

export function ThankYou({
  orderId,
  orderNumberFromUrl,
  initialOrder = null,
}: {
  orderId: string;
  orderNumberFromUrl: string | null;
  /** Server-prefetched order, threaded from the route ctx (optional). */
  initialOrder?: Order | null;
}) {
  const params = useParams() as { domain: string };
  const [order, setOrder] = useState<Order | null>(initialOrder);
  const [error, setError] = useState<string | null>(null);
  const [locale, setLocale] = useState("en");
  // True only once the customer-scoped order fetch succeeds — i.e. the visitor
  // is signed in. Guests stay false so we don't link them to /account/orders
  // (which redirects to /account/login).
  const [authed, setAuthed] = useState(false);

  const isAr = locale === "ar";
  const T = (en: string, ar: string) => (isAr ? ar : en);

  useEffect(() => {
    if (typeof document !== "undefined") {
      setLocale(document.documentElement.lang === "ar" ? "ar" : "en");
    }
    (async () => {
      try {
        // Correct customer-scoped path is /api/customer/me/orders/{id}
        // (proxies to storefront/me/orders/{id}); the bare
        // /api/customer/orders/{id} has no GET handler and 404s for
        // everyone — which is why the confirmation only ever showed the
        // number + total via the guest fallback before.
        const res = await fetch(`/api/customer/me/orders/${orderId}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          // 404 here is plausible for guests whose session cookie doesn't
          // carry the order. If we already have a prefetched order, keep
          // it; otherwise show a graceful "order placed" message.
          if (res.status === 404) {
            if (!initialOrder) {
              setError(
                orderNumberFromUrl
                  ? T(
                      `Your order ${orderNumberFromUrl} has been placed.`,
                      `تم استلام طلبك ${orderNumberFromUrl}.`,
                    )
                  : T(
                      "Your order has been placed.",
                      "تم استلام طلبك.",
                    ),
              );
            }
            return;
          }
          if (!initialOrder) {
            setError(
              T(
                "We've sent your order confirmation to your email and WhatsApp — with your items, delivery details, and tracking. Keep your order number handy to follow up.",
                "بعتنالك تأكيد الطلب على الإيميل وواتساب — وفيه تفاصيل المنتجات والتوصيل والتتبّع. احتفظ برقم الطلب لأي استفسار.",
              ),
            );
          }
          return;
        }
        const body = await res.json();
        setOrder((body?.data || body) as Order);
        setAuthed(true);
      } catch {
        if (!initialOrder) {
          setError(
            T(
              "We've emailed your order confirmation. To see full order details — items, delivery, and tracking — sign in with the email you used at checkout, or open the link in that email.",
              "بعتنالك تأكيد الطلب على الإيميل. لرؤية تفاصيل طلبك كاملة — المنتجات والتوصيل والتتبّع — سجّل الدخول بنفس الإيميل اللي طلبت بيه، أو افتح اللينك في الإيميل.",
            ),
          );
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, orderNumberFromUrl]);

  const currency = order?.currency || "EGP";
  const lines = order?.line_items ?? order?.items ?? [];
  const addr = order?.shipping_address;
  const offers = Array.isArray(order?.applied_promotions)
    ? order!.applied_promotions!
    : [];

  const fullName =
    addr?.full_name ||
    [addr?.first_name, addr?.last_name].filter(Boolean).join(" ");

  const displayNumber =
    order?.order_number || orderNumberFromUrl || `…${orderId.slice(-8)}`;

  const STATUS_IDX: Record<string, number> = {
    pending: 0, placed: 0, paid: 1, confirmed: 1, processing: 1,
    shipped: 2, out_for_delivery: 2, delivered: 3, completed: 3,
  };
  const statusIdx = STATUS_IDX[(order?.status || "").toLowerCase()] ?? 0;
  const statusLabel = [
    T("Placed", "تم الطلب"),
    T("Confirmed", "تم التأكيد"),
    T("Shipped", "تم الشحن"),
    T("Delivered", "تم التوصيل"),
  ][statusIdx];

  return (
    <div className="mx-auto max-w-2xl space-y-5" dir={isAr ? "rtl" : "ltr"}>
      {/* Success hero */}
      <section className="overflow-hidden rounded-[var(--ck-radius)] border border-[var(--ck-border)] bg-[var(--ck-surface)] text-center shadow-[var(--ck-shadow)]">
        <div className="px-6 pb-9 pt-11">
          <img
            src="/success.svg"
            alt=""
            aria-hidden
            width={88}
            height={88}
            className="mx-auto mb-5 h-[88px] w-[88px]"
          />
          <h1 className="text-[26px] text-[var(--ck-fg)] [font-family:var(--ck-heading-font)] [font-weight:var(--ck-heading-weight)] [letter-spacing:var(--ck-heading-tracking)] [text-transform:var(--ck-heading-transform)]">
            {T("Thank you for your order!", "شكراً لطلبك!")}
          </h1>
          <p className="mt-2 text-[15px] text-[var(--ck-muted)]">
            {T(
              "We've sent your order confirmation to your email and WhatsApp.",
              "بعتنالك تأكيد طلبك على الإيميل وعلى واتساب.",
            )}
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[var(--ck-border)] bg-[var(--ck-bg)] px-4 py-2 text-sm">
            <span className="text-[var(--ck-muted)]">{T("Order", "الطلب")}</span>
            <span className="font-mono font-semibold text-[var(--ck-fg)]" dir="ltr">
              {displayNumber}
            </span>
          </div>

          {/* Notification channels */}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ck-border)] px-3 py-1.5 text-xs text-[var(--ck-muted)]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m22 7-10 5L2 7" />
              </svg>
              {T("Emailed", "تم الإرسال بالإيميل")}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#25D366]/40 bg-[#25D366]/10 px-3 py-1.5 text-xs font-medium text-[#128C4B]">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M.057 24l1.687-6.163a11.867 11.867 0 0 1-1.587-5.946C.16 5.335 5.495 0 12.05 0a11.817 11.817 0 0 1 8.413 3.488 11.824 11.824 0 0 1 3.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 0 1-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 0 0 1.51 5.26l-.999 3.648 3.978-1.04zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.017-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.71.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z" />
              </svg>
              {T("WhatsApp sent", "تم الإرسال على واتساب")}
            </span>
          </div>
        </div>
      </section>

      {order && lines.length > 0 && (
        <section className="rounded-[var(--ck-radius)] border border-[var(--ck-border)] bg-[var(--ck-surface)] p-6 shadow-[var(--ck-shadow)]">
          <h2 className="mb-3 text-lg font-semibold tracking-tight text-[var(--ck-fg)]">
            {T("Items", "المنتجات")}
          </h2>
          <ul className="divide-y divide-gray-100">
            {lines.map((l, i) => (
              <li
                key={`${l.product_id}-${i}`}
                className="flex items-start justify-between gap-3 py-2.5 text-sm"
              >
                <span className="min-w-0">
                  <span className="font-medium text-gray-900">
                    {l.product_name ||
                      `${T("Item", "منتج")} ${l.product_id.slice(0, 8)}`}
                  </span>
                  {l.variant_name && (
                    <span className="block text-xs text-gray-500">
                      {l.variant_name}
                    </span>
                  )}
                  <span className="text-gray-500"> × {l.quantity}</span>
                </span>
                <span className="shrink-0 font-medium text-gray-900">
                  {fmt(lineAmount(l), currency)}
                </span>
              </li>
            ))}
          </ul>

          {/* Totals breakdown */}
          <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
            {order.subtotal != null && (
              <Row
                label={T("Subtotal", "الإجمالي الفرعي")}
                value={fmt(order.subtotal, currency)}
              />
            )}
            {Boolean(order.discount_amount) && (
              <Row
                label={
                  <span className="flex items-center gap-1.5">
                    {T("Discount", "الخصم")}
                    {order.coupon_code && (
                      <span
                        className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
                        dir="ltr"
                      >
                        {order.coupon_code}
                      </span>
                    )}
                  </span>
                }
                value={`−${fmt(order.discount_amount, currency)}`}
                positive
              />
            )}
            {offers.map((p, i) => (
              <Row
                key={p.id || i}
                label={(isAr ? p.title_ar : undefined) || p.title || T("Offer", "عرض")}
                value={`−${fmt(p.amount, currency)}`}
                positive
              />
            ))}
            {order.shipping_cost != null && (
              <Row
                label={T("Shipping", "الشحن")}
                value={
                  order.shipping_cost === 0
                    ? T("Free", "مجاناً")
                    : fmt(order.shipping_cost, currency)
                }
              />
            )}
            {Boolean(order.tax_amount) && (
              <Row
                label={T("Tax", "الضريبة")}
                value={fmt(order.tax_amount, currency)}
              />
            )}
            <Row
              label={T("Total", "الإجمالي")}
              value={fmt(order.total, currency)}
              emphasis
            />
          </div>
        </section>
      )}

      {order && (addr || order.payment_method || order.shipping_method) && (
        <section className="rounded-[var(--ck-radius)] border border-[var(--ck-border)] bg-[var(--ck-surface)] p-6 shadow-[var(--ck-shadow)]">
          <h2 className="mb-3 text-lg font-semibold tracking-tight text-[var(--ck-fg)]">
            {T("Delivery", "التوصيل")}
          </h2>
          {addr && (
            <div
              className="text-sm leading-relaxed text-gray-700"
              dir="auto"
            >
              {fullName && (
                <p className="font-medium text-gray-900">{fullName}</p>
              )}
              {addr.address_line1 && <p>{addr.address_line1}</p>}
              {addr.address_line2 && <p>{addr.address_line2}</p>}
              <p>
                {[addr.city, addr.state, addr.postal_code]
                  .filter(Boolean)
                  .join(", ")}
              </p>
              {addr.country && <p>{addr.country}</p>}
              {addr.phone && (
                <p className="text-gray-500" dir="ltr">
                  {addr.phone}
                </p>
              )}
            </div>
          )}
          {(order.shipping_method || order.payment_method) && (
            <p className="mt-3 border-t border-gray-100 pt-3 text-sm text-gray-500">
              {[order.shipping_method, order.payment_method]
                .filter(Boolean)
                .join(" · ")}
            </p>
          )}
        </section>
      )}

      {error && (
        <div
          role="status"
          className="rounded-[var(--ck-radius)] border border-[var(--ck-border)] bg-[var(--ck-surface)] p-5 shadow-[var(--ck-shadow)]"
        >
          <div className="flex items-start gap-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--ck-accent-tint)] text-[var(--ck-accent)]">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="2" y="4" width="20" height="16" rx="2" />
                <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              </svg>
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[var(--ck-fg)]">
                {T("Confirmation sent", "تم إرسال التأكيد")}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-[var(--ck-muted)]">
                {error}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Order tracking */}
      <section className="rounded-[var(--ck-radius)] border border-[var(--ck-border)] bg-[var(--ck-surface)] p-6 shadow-[var(--ck-shadow)]">
        <div className="mb-6 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-[var(--ck-fg)]">
            {T("Order tracking", "تتبّع الطلب")}
          </h2>
          <span className="rounded-full bg-[var(--ck-accent-tint)] px-3 py-1 text-xs font-medium text-[var(--ck-accent)]">
            {statusLabel}
          </span>
        </div>
        <Tracker order={order} T={T} />
        {authed ? (
          <Link
            href={`/${params.domain}/account/orders/${orderId}`}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-[var(--ck-radius-sm)] border border-[var(--ck-border)] px-6 py-3 text-sm font-semibold text-[var(--ck-fg)] transition-colors hover:bg-[var(--ck-bg)] sm:w-auto"
          >
            {T("Track your order", "تتبّع طلبك")}
            <span aria-hidden className="rtl:rotate-180">→</span>
          </Link>
        ) : (
          <p className="mt-6 flex items-center justify-center gap-2 text-sm text-[var(--ck-muted)] sm:justify-start">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4 20-7z" />
            </svg>
            {T(
              "We'll send tracking updates to your email and WhatsApp.",
              "هنبعتلك تحديثات التتبّع على الإيميل وواتساب.",
            )}
          </p>
        )}
      </section>

      <div className="pt-1">
        <Link
          href={`/${params.domain}`}
          className="inline-flex w-full items-center justify-center rounded-[var(--ck-radius-sm)] bg-[var(--ck-button)] px-6 py-3.5 text-sm font-semibold text-[var(--ck-button-text)] shadow-[var(--ck-shadow)] transition-transform hover:-translate-y-0.5"
        >
          {T("Continue shopping", "متابعة التسوق")}
        </Link>
      </div>
    </div>
  );
}

/** Horizontal status stepper. Marks progress from the order status; defaults to
 *  "placed" (step 0 done) for a freshly-placed order / guest fallback. */
function Tracker({
  order,
  T,
}: {
  order: Order | null;
  T: (en: string, ar: string) => string;
}) {
  const steps = [
    { key: "placed", en: "Placed", ar: "تم الطلب" },
    { key: "confirmed", en: "Confirmed", ar: "تم التأكيد" },
    { key: "shipped", en: "Shipped", ar: "تم الشحن" },
    { key: "delivered", en: "Delivered", ar: "تم التوصيل" },
  ];
  const order_idx: Record<string, number> = {
    pending: 0,
    placed: 0,
    paid: 1,
    confirmed: 1,
    processing: 1,
    shipped: 2,
    out_for_delivery: 2,
    delivered: 3,
    completed: 3,
  };
  const current = order_idx[(order?.status || "").toLowerCase()] ?? 0;

  return (
    <ol className="flex items-start">
      {steps.map((s, i) => {
        const done = i <= current;
        const isCurrent = i === current;
        return (
          <li key={s.key} className="relative flex flex-1 flex-col items-center">
            {i < steps.length - 1 && (
              <span
                aria-hidden
                className="absolute top-[15px] h-[3px] w-full rounded-full ltr:left-1/2 rtl:right-1/2"
                style={{
                  background: i < current ? "var(--ck-accent)" : "var(--ck-border)",
                }}
              />
            )}
            <span
              className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-shadow"
              style={{
                background: done ? "var(--ck-accent)" : "var(--ck-surface)",
                color: done ? "var(--ck-accent-text)" : "var(--ck-muted)",
                border: `2px solid ${done ? "var(--ck-accent)" : "var(--ck-border)"}`,
                boxShadow: isCurrent ? "0 0 0 5px var(--ck-accent-tint)" : undefined,
              }}
            >
              {done ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                i + 1
              )}
            </span>
            <span
              className="mt-3 text-center text-[11px] font-medium"
              style={{ color: done ? "var(--ck-fg)" : "var(--ck-muted)" }}
            >
              {T(s.en, s.ar)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Row({
  label,
  value,
  emphasis,
  positive,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  emphasis?: boolean;
  positive?: boolean;
}) {
  return (
    <div
      className={
        emphasis
          ? "flex items-center justify-between border-t border-[var(--ck-border)] pt-3 text-base font-semibold text-[var(--ck-fg)]"
          : "flex items-center justify-between text-sm"
      }
    >
      <span className={emphasis ? "" : "text-[var(--ck-muted)]"}>{label}</span>
      <span
        className={
          emphasis
            ? ""
            : positive
              ? "font-medium text-emerald-700"
              : "font-medium text-[var(--ck-fg)]"
        }
      >
        {value}
      </span>
    </div>
  );
}
