"use client";

/**
 * Sticky order summary for the platform checkout.
 *
 * Reads the live cart from `/api/cart` (the same Redis-backed cart the
 * review step posts against) and renders line items + a full totals
 * breakdown (Subtotal, Discount, Automatic offers, Shipping, Tax, Total)
 * plus a coupon Apply/remove field. On desktop it sits in a sticky right
 * column; on mobile it collapses into a tappable bar at the top of the
 * page that expands to show the items + breakdown.
 *
 * Shipping is read from the checkout-state cache (the selected rate's
 * amount, persisted by ShippingStep) so the Total reflects shipping from
 * the payment step onward without re-fetching rates. A `numu:checkout:updated`
 * (or `numu:cart:updated`) event re-reads both cart + state.
 *
 * Coupon: POST/DELETE `/api/cart/discount` (CSRF double-submit). The applied
 * code is mirrored into checkout-state so the review step submits it. The
 * backend pins the code on the cart and computes the discount at checkout;
 * if the cart response surfaces a `discount_amount`/`applied_promotion`, we
 * show the "−EGP X" line, otherwise we show the code as applied.
 *
 * Purely presentational beyond the coupon write — a fetch failure degrades
 * to a quiet placeholder; the checkout still works. Bilingual (en +
 * Egyptian Arabic), RTL-safe via logical spacing.
 */

import { useCallback, useEffect, useState } from "react";
import { formatCents } from "@/lib/money";
import { patchCheckoutState, readCheckoutState } from "@/lib/checkout-state";
import { PromoCartHints } from "@/components/promo/PromoCartHints";

interface CartLine {
  product_id: string;
  variant_id?: string | null;
  quantity: number;
  unit_price?: number;
  // Backend (CartItemResponse) names the per-line amount `total_price`.
  // Keep `subtotal` as a tolerant fallback for any older payload shape.
  total_price?: number;
  subtotal?: number;
  product_name?: string;
  image_url?: string | null;
  variant_name?: string | null;
  // The /api/cart proxy may return the SDK CartItem shape instead
  // (`name` + per-unit `price` in cents) — tolerate both so the line
  // renders the real name + amount rather than a fallback id + 0.00.
  name?: string;
  price?: number;
}

/** The line's display name across both cart payload shapes. */
function lineName(l: CartLine): string | undefined {
  return l.product_name || l.name || undefined;
}

/** Per-line amount in cents — prefer the backend's `total_price`, then a
 *  per-unit price (`unit_price` or the SDK shape's `price`) × quantity. */
function lineTotal(l: CartLine): number {
  return (
    l.total_price ??
    l.subtotal ??
    (l.unit_price ?? l.price ?? 0) * l.quantity
  );
}

/** An automatic (non-coupon) promotion line. */
interface PromotionLine {
  id?: string;
  title?: string;
  title_ar?: string;
  label?: string;
  code?: string;
  amount: number; // cents
}

interface Cart {
  items: CartLine[];
  subtotal?: number;
  total?: number;
  currency?: string;
  // Optional totals the backend may surface (all int cents). Absent on the
  // base CartResponse today; read defensively so we light up when present.
  discount_amount?: number;
  tax_amount?: number;
  shipping_cost?: number;
  // A single coupon promotion (BuiltInCart shape) …
  applied_promotion?: PromotionLine | null;
  // … or a list of automatic promotions (offers v2 shape).
  applied_promotions?: PromotionLine[];
  // Coupon code the backend has pinned to the cart, if any.
  discount_code?: string | null;
  coupon_code?: string | null;
}

function readCsrf(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.match(/(?:^|; )numu_csrf=([^;]+)/)?.[1] ?? "";
}

function promoLabel(p: PromotionLine, isAr: boolean): string {
  return (
    (isAr ? p.title_ar : undefined) ||
    p.title ||
    p.label ||
    p.code ||
    (isAr ? "خصم" : "Discount")
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function BagIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

/** A single label/amount row in the totals breakdown. */
function TotalRow({
  label,
  value,
  emphasis,
  positive,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  emphasis?: boolean;
  /** Render in discount green (for negative discount/offer lines). */
  positive?: boolean;
}) {
  return (
    <div
      className={
        emphasis
          ? "flex items-center justify-between border-t-[length:var(--ck-frame-width)] border-[var(--ck-frame)] pt-3 text-base text-[var(--ck-fg)] [font-weight:var(--ck-heading-weight)] [letter-spacing:var(--ck-heading-tracking)] [text-transform:var(--ck-heading-transform)]"
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

function CouponField({
  currency,
  locale,
  onApplied,
}: {
  currency: string;
  locale: string;
  onApplied: () => void;
}) {
  const isAr = locale === "ar";
  const [code, setCode] = useState(
    () => readCheckoutState().coupon_code || "",
  );
  const [applied, setApplied] = useState<string | null>(
    () => readCheckoutState().coupon_code || null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const C = {
    label: { en: "Discount code", ar: "كود الخصم" },
    apply: { en: "Apply", ar: "تطبيق" },
    applying: { en: "Applying…", ar: "جارٍ التطبيق…" },
    removing: { en: "Removing…", ar: "جارٍ الإزالة…" },
    remove: { en: "Remove", ar: "إزالة" },
    invalid: {
      en: "That code isn't valid for this store.",
      ar: "الكود ده مش صالح للمتجر ده.",
    },
    applied: { en: "Code applied", ar: "تم تطبيق الكود" },
  };
  const c = (k: keyof typeof C) => (isAr ? C[k].ar : C[k].en);

  async function apply() {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const csrf = readCsrf();
      const res = await fetch("/api/cart/discount", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "x-numu-csrf": csrf } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ code: trimmed }),
      });
      if (!res.ok) {
        // 400 = invalid/inactive coupon (backend message). Show a friendly
        // localized error rather than the raw detail.
        setError(c("invalid"));
        return;
      }
      setApplied(trimmed);
      patchCheckoutState({ coupon_code: trimmed });
      // Recompute the summary — the backend may surface a discount line.
      onApplied();
    } catch {
      setError(c("invalid"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const csrf = readCsrf();
      await fetch("/api/cart/discount", {
        method: "DELETE",
        headers: { ...(csrf ? { "x-numu-csrf": csrf } : {}) },
        credentials: "include",
      });
    } catch {
      /* swallow — clear locally regardless so the UI doesn't get stuck */
    } finally {
      setApplied(null);
      setCode("");
      patchCheckoutState({ coupon_code: "" });
      setBusy(false);
      onApplied();
    }
  }

  if (applied) {
    return (
      <div className="mt-4 border-t border-gray-100 pt-4">
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
          <span className="flex items-center gap-2 text-emerald-800">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span className="font-medium" dir="ltr">
              {applied}
            </span>
            <span className="text-emerald-700">— {c("applied")}</span>
          </span>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="text-xs text-gray-500 hover:text-red-700 disabled:opacity-50"
            aria-label={`${c("remove")} ${applied}`}
          >
            {busy ? c("removing") : c("remove")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 border-t border-[var(--ck-border)] pt-4">
      <label
        htmlFor="order-summary-coupon"
        className="mb-1.5 block text-xs text-[var(--ck-fg)] [font-weight:var(--ck-label-weight)] [letter-spacing:var(--ck-label-tracking)] [text-transform:var(--ck-label-transform)]"
      >
        {c("label")}
      </label>
      <div className="flex gap-2">
        <input
          id="order-summary-coupon"
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void apply();
            }
          }}
          maxLength={64}
          dir="ltr"
          placeholder={isAr ? "أدخل الكود" : "Enter code"}
          disabled={busy}
          className="block w-full rounded-[var(--ck-radius-sm)] border-[length:var(--ck-frame-width)] border-[var(--ck-frame)] bg-[var(--ck-surface)] px-3.5 py-2 text-sm uppercase text-[var(--ck-fg)] outline-none transition-colors placeholder:text-[var(--ck-muted)] placeholder:normal-case focus:border-[var(--ck-ring)] focus:ring-2 focus:ring-[var(--ck-ring)]/25 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="button"
          onClick={apply}
          disabled={busy || !code.trim()}
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--ck-button)] px-5 py-2 text-sm font-semibold text-[var(--ck-button-text)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? c("applying") : c("apply")}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      <input type="hidden" name="_currency" value={currency} />
    </div>
  );
}

function Lines({ cart, locale }: { cart: Cart; locale: string }) {
  const isAr = locale === "ar";
  const currency = cart.currency || "EGP";
  return (
    <ul className="space-y-3">
      {cart.items.map((l, i) => (
        <li
          key={`${l.product_id}-${l.variant_id || ""}-${i}`}
          className="flex items-start gap-3"
        >
          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-[var(--ck-radius-sm)] border border-[var(--ck-border)] bg-[var(--ck-surface-2)]">
            {l.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={l.image_url}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-[var(--ck-muted)]">
                <BagIcon />
              </span>
            )}
            <span className="absolute -end-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--ck-fg)] px-1 text-[10px] font-semibold text-[var(--ck-surface)]">
              {l.quantity}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-[var(--ck-fg)]">
              {lineName(l) ||
                `${isAr ? "منتج" : "Item"} ${l.product_id.slice(0, 8)}`}
            </p>
            {l.variant_name && (
              <p className="truncate text-xs text-[var(--ck-muted)]">{l.variant_name}</p>
            )}
          </div>
          <span className="shrink-0 text-sm font-medium text-[var(--ck-fg)]">
            {formatCents(lineTotal(l), currency)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Totals breakdown. Subtotal from the cart; shipping from the cached
 * checkout-state rate (or the cart's own `shipping_cost` when present);
 * discount/offers/tax read defensively from the cart response.
 */
function Breakdown({
  cart,
  locale,
  shippingCents,
}: {
  cart: Cart;
  locale: string;
  shippingCents: number | null;
}) {
  const isAr = locale === "ar";
  const currency = cart.currency || "EGP";

  const subtotal =
    cart.subtotal ?? cart.items.reduce((s, l) => s + lineTotal(l), 0);

  // Coupon discount: explicit `discount_amount`, else a single
  // `applied_promotion.amount` if the response carries one.
  const couponDiscount =
    cart.discount_amount ?? cart.applied_promotion?.amount ?? 0;

  // Automatic (non-coupon) offers — offers-v2 list.
  const offers = Array.isArray(cart.applied_promotions)
    ? cart.applied_promotions
    : [];
  const offersTotal = offers.reduce((s, p) => s + (p.amount || 0), 0);

  // Shipping: cart's own value wins (it's authoritative if the backend
  // ever surfaces it); else the cached selected-rate amount.
  const shipping = cart.shipping_cost ?? shippingCents;
  const tax = cart.tax_amount ?? 0;

  const total = Math.max(
    0,
    subtotal - couponDiscount - offersTotal + (shipping ?? 0) + tax,
  );

  const free = isAr ? "مجاناً" : "Free";

  return (
    <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
      <TotalRow
        label={isAr ? "الإجمالي الفرعي" : "Subtotal"}
        value={formatCents(subtotal, currency)}
      />

      {couponDiscount > 0 && (
        <TotalRow
          label={
            <span className="flex items-center gap-1.5">
              {isAr ? "الخصم" : "Discount"}
              {(cart.applied_promotion?.code || cart.coupon_code) && (
                <span
                  className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700"
                  dir="ltr"
                >
                  {cart.applied_promotion?.code || cart.coupon_code}
                </span>
              )}
            </span>
          }
          value={`−${formatCents(couponDiscount, currency)}`}
          positive
        />
      )}

      {offers.map((p, i) => (
        <TotalRow
          key={p.id || i}
          label={promoLabel(p, isAr)}
          value={`−${formatCents(p.amount, currency)}`}
          positive
        />
      ))}

      {shipping != null && (
        <TotalRow
          label={isAr ? "الشحن" : "Shipping"}
          value={shipping === 0 ? free : formatCents(shipping, currency)}
        />
      )}

      {tax > 0 && (
        <TotalRow
          label={isAr ? "الضريبة" : "Tax"}
          value={formatCents(tax, currency)}
        />
      )}

      <TotalRow
        label={isAr ? "الإجمالي" : "Total"}
        value={formatCents(total, currency)}
        emphasis
      />

      {shipping == null && (
        <p className="pt-1 text-xs text-[var(--ck-muted)]">
          {isAr
            ? "تُحسب الشحن والضرائب في الخطوات التالية."
            : "Shipping & taxes calculated at the next steps."}
        </p>
      )}
    </div>
  );
}

export function OrderSummary() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [failed, setFailed] = useState(false);
  const [locale, setLocale] = useState("en");
  const [openMobile, setOpenMobile] = useState(false);
  const [shippingCents, setShippingCents] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      // `credentials: "include"` mirrors the SDK's own cart fetch — without it
      // the guest `numu_cart_session` cookie can be dropped in embedded
      // (iframe/customizer) contexts, 400-ing store/cart resolution. Retry
      // once so a single transient miss doesn't dead-end the whole checkout.
      let res = await fetch("/api/cart", {
        cache: "no-store",
        credentials: "include",
      });
      if (!res.ok) {
        res = await fetch("/api/cart", {
          cache: "no-store",
          credentials: "include",
        });
      }
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const body = await res.json();
      const c = (body?.data || body) as Cart;
      setFailed(false);

      // Preview the automatic-offer discount (BOGO / %, etc.) so the Total
      // matches what the order will be charged — the cart response itself
      // doesn't carry computed offers, only the per-line subtotal. We hit the
      // same engine the order-create path runs (/api/cart/discounts →
      // DiscountCalculator) and fold the result in as an offers line the
      // Breakdown already knows how to render. Best-effort: any miss leaves
      // the cart untouched (subtotal + shipping only) — never throws.
      const items = (c.items || [])
        .map((l) => {
          const qty = l.quantity || 0;
          const unit =
            l.unit_price ??
            l.price ??
            (qty > 0 ? Math.round(lineTotal(l) / qty) : 0);
          return {
            product_id: l.product_id,
            quantity: qty,
            unit_price_cents: unit,
          };
        })
        .filter((it) => it.product_id && it.quantity > 0);

      if (items.length > 0) {
        try {
          const couponCode = readCheckoutState().coupon_code;
          const dr = await fetch("/api/cart/discounts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            cache: "no-store",
            body: JSON.stringify({
              items,
              applied_codes: couponCode ? [couponCode] : [],
            }),
          });
          if (dr.ok) {
            const dj = await dr.json();
            const out = dj?.data || dj;
            // Prefer the engine's NAMED snapshot ({id,title,title_ar?,amount})
            // so the line reads "Welcome 10 −EGP 30" with the real promo name.
            const named: PromotionLine[] = Array.isArray(out?.applied_promotions)
              ? out.applied_promotions.filter(
                  (p: PromotionLine) => p && Number(p.amount) > 0,
                )
              : [];
            const auto = Number(out?.automatic_discount_cents || 0);
            if (named.length > 0) {
              c.applied_promotions = named;
            } else if (auto > 0) {
              // Fallback: a generic aggregate line if a name wasn't resolved.
              c.applied_promotions = [
                { id: "auto-offers", title: "Offer", title_ar: "العرض", amount: auto },
              ];
            }
            // Coupon CODE discount is a separate field on the engine response
            // (`code_discount_cents`) — NOT part of `applied_promotions` /
            // `automatic_discount_cents`. Fold it into the cart's
            // `discount_amount` so the Breakdown renders the "Discount −EGP X"
            // line and the Total drops the moment a code is applied. Without
            // this the UI silently ignored every coupon.
            const codeDiscount = Number(out?.code_discount_cents || 0);
            if (codeDiscount > 0) {
              c.discount_amount = codeDiscount;
              if (couponCode) c.coupon_code = couponCode;
            }
          }
        } catch {
          /* best-effort — render the cart without the offer line */
        }
      }

      setCart(c);
    } catch {
      setFailed(true);
    }
  }, []);

  const syncShipping = useCallback(() => {
    setShippingCents(readCheckoutState().shipping_cost_cents);
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      setLocale(document.documentElement.lang === "ar" ? "ar" : "en");
    }
    syncShipping();
    void load();
    // Recompute when the cart OR the checkout state (shipping/coupon)
    // changes — either via the SDK's cart event or our own checkout event.
    const onUpdate = () => {
      syncShipping();
      void load();
    };
    window.addEventListener("numu:cart:updated", onUpdate);
    window.addEventListener("numu:checkout:updated", onUpdate);
    return () => {
      window.removeEventListener("numu:cart:updated", onUpdate);
      window.removeEventListener("numu:checkout:updated", onUpdate);
    };
  }, [load, syncShipping]);

  const isAr = locale === "ar";
  const currency = cart?.currency || "EGP";
  const itemCount = cart?.items?.reduce((s, l) => s + l.quantity, 0) ?? 0;

  // Mobile collapsed bar shows the running Total (incl. shipping/discount
  // when known) rather than just the subtotal.
  const collapsedTotal = (() => {
    if (!cart) return 0;
    const subtotal =
      cart.subtotal ?? cart.items.reduce((s, l) => s + lineTotal(l), 0);
    const discount =
      (cart.discount_amount ?? cart.applied_promotion?.amount ?? 0) +
      (Array.isArray(cart.applied_promotions)
        ? cart.applied_promotions.reduce((s, p) => s + (p.amount || 0), 0)
        : 0);
    const shipping = cart.shipping_cost ?? shippingCents ?? 0;
    const tax = cart.tax_amount ?? 0;
    return Math.max(0, subtotal - discount + shipping + tax);
  })();

  const heading = isAr ? "ملخص الطلب" : "Order summary";

  const body = (() => {
    if (failed) {
      return (
        <p className="text-sm text-[var(--ck-muted)]">
          {isAr ? "تعذّر تحميل الملخص." : "Couldn't load the summary."}
        </p>
      );
    }
    if (!cart) {
      return (
        <div className="space-y-3" aria-hidden>
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-14 w-14 shrink-0 animate-pulse rounded-[var(--ck-radius-sm)] bg-[var(--ck-surface-2)]" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-3/4 animate-pulse rounded bg-[var(--ck-surface-2)]" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-[var(--ck-surface-2)]" />
              </div>
            </div>
          ))}
        </div>
      );
    }
    if (cart.items.length === 0) {
      return (
        <p className="text-sm text-[var(--ck-muted)]">
          {isAr ? "سلة التسوق فارغة." : "Your cart is empty."}
        </p>
      );
    }
    return (
      <>
        <Lines cart={cart} locale={locale} />
        <PromoCartHints
          subtotalCents={
            cart.subtotal ?? cart.items.reduce((s, l) => s + lineTotal(l), 0)
          }
          currency={currency}
          locale={locale}
        />
        <Breakdown cart={cart} locale={locale} shippingCents={shippingCents} />
        <CouponField
          currency={currency}
          locale={locale}
          onApplied={() => {
            syncShipping();
            void load();
          }}
        />
      </>
    );
  })();

  return (
    <>
      {/* Mobile: collapsible bar (above the form). */}
      <div className="lg:hidden">
        <div className="overflow-hidden rounded-[var(--ck-radius)] border-[length:var(--ck-frame-width)] border-[var(--ck-frame)] bg-[var(--ck-surface)] [box-shadow:var(--ck-shadow)]">
          <button
            type="button"
            onClick={() => setOpenMobile((o) => !o)}
            aria-expanded={openMobile}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-[var(--ck-fg)]">
              <BagIcon />
              <span>
                {openMobile
                  ? isAr
                    ? "إخفاء الملخص"
                    : "Hide order summary"
                  : isAr
                    ? "عرض الملخص"
                    : "Show order summary"}
              </span>
              <ChevronIcon open={openMobile} />
            </span>
            <span className="text-sm font-semibold text-[var(--ck-fg)]">
              {formatCents(collapsedTotal, currency)}
            </span>
          </button>
          {openMobile && (
            <div className="border-t border-[var(--ck-border)] p-4">{body}</div>
          )}
        </div>
      </div>

      {/* Desktop: sticky card. */}
      <aside className="hidden lg:block">
        <div className="sticky top-8 rounded-[var(--ck-radius)] border-[length:var(--ck-frame-width)] border-[var(--ck-frame)] bg-[var(--ck-surface)] p-6 [box-shadow:var(--ck-shadow)]">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base text-[var(--ck-fg)] [font-family:var(--ck-heading-font)] [font-weight:var(--ck-heading-weight)] [letter-spacing:var(--ck-heading-tracking)] [text-transform:var(--ck-heading-transform)]">
              {heading}
            </h2>
            {itemCount > 0 && (
              <span className="rounded-full bg-[var(--ck-surface-2)] px-2.5 py-0.5 text-xs font-medium text-[var(--ck-muted)]">
                {itemCount} {isAr ? "منتج" : itemCount === 1 ? "item" : "items"}
              </span>
            )}
          </div>
          {body}
        </div>
      </aside>
    </>
  );
}
