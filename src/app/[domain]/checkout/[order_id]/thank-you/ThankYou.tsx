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
                "We've emailed your order confirmation. To see full order details — items, delivery, and tracking — sign in with the email you used at checkout, or open the link in that email.",
                "بعتنالك تأكيد الطلب على الإيميل. لرؤية تفاصيل طلبك كاملة — المنتجات والتوصيل والتتبّع — سجّل الدخول بنفس الإيميل اللي طلبت بيه، أو افتح اللينك في الإيميل.",
              ),
            );
          }
          return;
        }
        const body = await res.json();
        setOrder((body?.data || body) as Order);
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

  return (
    <div className="mx-auto max-w-2xl space-y-5" dir={isAr ? "rtl" : "ltr"}>
      {/* Success hero */}
      <section className="overflow-hidden rounded-[var(--ck-radius)] border border-[var(--ck-border)] bg-[var(--ck-surface)] text-center shadow-[var(--ck-shadow)]">
        <div className="px-6 pb-9 pt-11">
          <span className="mx-auto mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[var(--ck-accent-tint)]">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--ck-accent)"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
              className="h-9 w-9"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
          </span>
          <h1 className="text-[26px] text-[var(--ck-fg)] [font-family:var(--ck-heading-font)] [font-weight:var(--ck-heading-weight)] [letter-spacing:var(--ck-heading-tracking)] [text-transform:var(--ck-heading-transform)]">
            {T("Thank you for your order!", "شكراً لطلبك!")}
          </h1>
          <p className="mt-2 text-[15px] text-[var(--ck-muted)]">
            {T(
              "A confirmation is on its way to your inbox.",
              "هنبعتلك تأكيد على إيميلك حالاً.",
            )}
          </p>
          <div className="mt-5 inline-flex items-center gap-2 rounded-full border border-[var(--ck-border)] bg-[var(--ck-bg)] px-4 py-2 text-sm">
            <span className="text-[var(--ck-muted)]">{T("Order", "الطلب")}</span>
            <span className="font-mono font-semibold text-[var(--ck-fg)]" dir="ltr">
              {displayNumber}
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
          className="flex items-start gap-2.5 rounded-[var(--ck-radius-sm)] border border-[var(--ck-border)] bg-[var(--ck-accent-tint)] p-4 text-sm leading-relaxed text-[var(--ck-fg)]"
        >
          <span aria-hidden className="mt-0.5 shrink-0 text-base">📧</span>
          <p>{error}</p>
        </div>
      )}

      <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:justify-center">
        <Link
          href={`/${params.domain}`}
          className="inline-flex items-center justify-center rounded-[var(--ck-radius-sm)] bg-[var(--ck-button)] px-6 py-3 text-sm font-semibold text-[var(--ck-button-text)] shadow-[var(--ck-shadow)] transition-transform hover:-translate-y-0.5"
        >
          {T("Continue shopping", "متابعة التسوق")}
        </Link>
        <Link
          href={`/${params.domain}/account/orders`}
          className="inline-flex items-center justify-center rounded-[var(--ck-radius-sm)] border border-[var(--ck-border)] px-6 py-3 text-sm font-semibold text-[var(--ck-fg)] transition-colors hover:bg-[var(--ck-bg)]"
        >
          {T("View your orders", "عرض طلباتك")}
        </Link>
      </div>
    </div>
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
