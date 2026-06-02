"use client";

/**
 * Sticky order summary for the platform checkout.
 *
 * Reads the live cart from `/api/cart` (the same Redis-backed cart the
 * review step posts against) and renders line items + subtotal. On
 * desktop it sits in a sticky right column; on mobile it collapses into
 * a tappable bar at the top of the page that expands to show the items.
 *
 * Purely presentational/read-only — it never mutates the cart. A fetch
 * failure degrades to a quiet placeholder; the checkout still works.
 *
 * Bilingual (en + Egyptian Arabic), RTL-safe via logical spacing.
 */

import { useEffect, useState } from "react";

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
}

/** Per-line amount in cents — prefer the backend's `total_price`. */
function lineTotal(l: CartLine): number {
  return l.total_price ?? l.subtotal ?? (l.unit_price ?? 0) * l.quantity;
}

interface Cart {
  items: CartLine[];
  subtotal?: number;
  total?: number;
  currency?: string;
}

function formatCents(cents: number, currency = "EGP", locale = "en") {
  const intlLocale = locale === "ar" ? "ar-EG" : "en";
  try {
    return new Intl.NumberFormat(intlLocale, {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
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

function Lines({
  cart,
  locale,
}: {
  cart: Cart;
  locale: string;
}) {
  const isAr = locale === "ar";
  const currency = cart.currency || "EGP";
  const subtotal =
    cart.subtotal ?? cart.items.reduce((s, l) => s + lineTotal(l), 0);
  return (
    <>
      <ul className="space-y-3">
        {cart.items.map((l, i) => (
          <li
            key={`${l.product_id}-${l.variant_id || ""}-${i}`}
            className="flex items-start gap-3"
          >
            <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-gray-100">
              {l.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={l.image_url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-gray-300">
                  <BagIcon />
                </span>
              )}
              <span className="absolute -end-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gray-700 px-1 text-[10px] font-semibold text-white">
                {l.quantity}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">
                {l.product_name ||
                  `${isAr ? "منتج" : "Item"} ${l.product_id.slice(0, 8)}`}
              </p>
              {l.variant_name && (
                <p className="truncate text-xs text-gray-500">
                  {l.variant_name}
                </p>
              )}
            </div>
            <span className="shrink-0 text-sm font-medium text-gray-900">
              {formatCents(lineTotal(l), currency, locale)}
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-gray-100 pt-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-500">
            {isAr ? "الإجمالي الفرعي" : "Subtotal"}
          </span>
          <span className="font-semibold text-gray-900">
            {formatCents(subtotal, currency, locale)}
          </span>
        </div>
        <p className="mt-2 text-xs text-gray-400">
          {isAr
            ? "تُحسب الشحن والضرائب في الخطوات التالية."
            : "Shipping & taxes calculated at the next steps."}
        </p>
      </div>
    </>
  );
}

export function OrderSummary() {
  const [cart, setCart] = useState<Cart | null>(null);
  const [failed, setFailed] = useState(false);
  const [locale, setLocale] = useState("en");
  const [openMobile, setOpenMobile] = useState(false);

  useEffect(() => {
    if (typeof document !== "undefined") {
      setLocale(document.documentElement.lang === "ar" ? "ar" : "en");
    }
    (async () => {
      try {
        const res = await fetch("/api/cart", { cache: "no-store" });
        if (res.ok) {
          const body = await res.json();
          setCart((body?.data || body) as Cart);
        } else {
          setFailed(true);
        }
      } catch {
        setFailed(true);
      }
    })();
  }, []);

  const isAr = locale === "ar";
  const currency = cart?.currency || "EGP";
  const itemCount = cart?.items?.reduce((s, l) => s + l.quantity, 0) ?? 0;
  const subtotal =
    cart?.subtotal ??
    cart?.items?.reduce((s, l) => s + lineTotal(l), 0) ??
    0;

  const heading = isAr ? "ملخص الطلب" : "Order summary";

  const body = (() => {
    if (failed) {
      return (
        <p className="text-sm text-gray-400">
          {isAr ? "تعذّر تحميل الملخص." : "Couldn't load the summary."}
        </p>
      );
    }
    if (!cart) {
      return (
        <div className="space-y-3" aria-hidden>
          {[0, 1].map((i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-14 w-14 shrink-0 animate-pulse rounded-lg bg-gray-100" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-3/4 animate-pulse rounded bg-gray-100" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-gray-100" />
              </div>
            </div>
          ))}
        </div>
      );
    }
    if (cart.items.length === 0) {
      return (
        <p className="text-sm text-gray-500">
          {isAr ? "سلة التسوق فارغة." : "Your cart is empty."}
        </p>
      );
    }
    return <Lines cart={cart} locale={locale} />;
  })();

  return (
    <>
      {/* Mobile: collapsible bar (above the form). */}
      <div className="lg:hidden">
        <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setOpenMobile((o) => !o)}
            aria-expanded={openMobile}
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-gray-700">
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
            <span className="text-sm font-semibold text-gray-900">
              {formatCents(subtotal, currency, locale)}
            </span>
          </button>
          {openMobile && (
            <div className="border-t border-gray-100 p-4">{body}</div>
          )}
        </div>
      </div>

      {/* Desktop: sticky card. */}
      <aside className="hidden lg:block">
        <div className="sticky top-8 rounded-2xl border border-gray-200/80 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold tracking-tight text-gray-900">
              {heading}
            </h2>
            {itemCount > 0 && (
              <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
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
