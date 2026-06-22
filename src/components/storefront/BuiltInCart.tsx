"use client";

/**
 * Built-in cart page — used when a store has no `cart` template
 * configured AND no BYOT bundle. Talks to /api/cart directly. Same
 * "self-contained, no SDK context" shape as BuiltInProductDetail.
 *
 * Renders line items with variant option labels (Phase 8.1), the
 * applied promotion line (Phase 8.4), and an applied-gift-cards block
 * (Phase 8.3, populated by the /cart response's `gift_cards` field
 * once the checkout has redeemed any cards on this session).
 */

import { useCallback, useEffect, useState } from "react";
import { formatCents } from "@/lib/money";
import { PromoCartHints } from "@/components/promo/PromoCartHints";

/**
 * Wire format the backend's `_build_cart_response` emits — see
 * NUMU-api/src/api/v1/routes/storefront/cart.py. Prices are int cents
 * (snapshotted at add-time on the cart_item.unit_price column) so we
 * divide by 100 for display. `current_price` lets us flag merchant
 * price edits since the line was added; `sold_out_now` blocks
 * checkout when stock flips after add.
 */
interface LineItem {
  id: string;
  product_id: string;
  variant_id?: string | null;
  product_name?: string;
  variant_name?: string | null;
  image_url?: string | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  current_price?: number;
  price_changed?: boolean;
  available_now?: number | null;
  sold_out_now?: boolean;
}

interface CartResponse {
  items: LineItem[];
  item_count: number;
  total_quantity: number;
  subtotal: number;
  currency: string;
  applied_promotion?: {
    code?: string;
    label?: string;
    amount: number;
  } | null;
}

interface Props {
  storeCurrency?: string;
  cartUrl?: string;
  checkoutUrl?: string;
  /** Visitor locale ("ar" → Arabic + RTL). ENG-3: this built-in cart is the
   *  no-blank fallback for themes that ship no cart template, so it must be
   *  bilingual too (it would otherwise show English on an Arabic store). */
  locale?: string;
}

function readCsrf(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.match(/(?:^|; )numu_csrf=([^;]+)/)?.[1] ?? "";
}

/** Backend serializes prices as integer cents. */
function fmtCents(cents: number, currency: string): string {
  if (!Number.isFinite(cents)) return formatCents(0, currency);
  return formatCents(cents, currency);
}

export default function BuiltInCart({
  storeCurrency = "EGP",
  cartUrl = "/api/cart",
  checkoutUrl = "/checkout",
  locale,
}: Props) {
  const ar = (locale || "").toLowerCase().startsWith("ar");
  const dir = ar ? "rtl" : "ltr";
  const T = (en: string, arText: string) => (ar ? arText : en);
  const [cart, setCart] = useState<CartResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(cartUrl, {
        cache: "no-store",
        credentials: "include",
      });
      if (!res.ok) {
        setCart({
          items: [],
          item_count: 0,
          total_quantity: 0,
          subtotal: 0,
          currency: storeCurrency,
        });
        return;
      }
      const json = await res.json();
      const data = (json?.data ?? json) as CartResponse;
      setCart(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cart.");
    } finally {
      setLoading(false);
    }
  }, [cartUrl]);

  useEffect(() => {
    void load();
    const onUpdate = () => void load();
    window.addEventListener("numu:cart:updated", onUpdate);
    return () => window.removeEventListener("numu:cart:updated", onUpdate);
  }, [load]);

  async function updateQty(itemId: string, quantity: number) {
    const csrf = readCsrf();
    await fetch("/api/cart/update", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "x-numu-csrf": csrf } : {}),
      },
      credentials: "include",
      body: JSON.stringify({ item_id: itemId, quantity }),
    });
    window.dispatchEvent(new CustomEvent("numu:cart:updated"));
  }

  async function removeItem(itemId: string) {
    const csrf = readCsrf();
    await fetch("/api/cart/remove", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(csrf ? { "x-numu-csrf": csrf } : {}),
      },
      credentials: "include",
      body: JSON.stringify({ item_id: itemId }),
    });
    window.dispatchEvent(new CustomEvent("numu:cart:updated"));
  }

  const currency = cart?.currency || storeCurrency;

  if (loading && !cart) {
    return (
      <div dir={dir} className="mx-auto max-w-4xl p-8 text-center text-[var(--numu-ink-soft)] [font-family:var(--numu-sans)]">
        {T("Loading cart…", "جاري تحميل السلة…")}
      </div>
    );
  }
  if (error) {
    return (
      <div dir={dir} className="mx-auto max-w-4xl p-8 text-center text-red-700 [font-family:var(--numu-sans)]">
        {error}
      </div>
    );
  }
  if (!cart || cart.items.length === 0) {
    return (
      <div dir={dir} className="mx-auto max-w-4xl p-8 text-center [font-family:var(--numu-sans)]">
        <h1 className="mb-2 text-3xl font-bold text-[var(--numu-ink)] [font-family:var(--numu-display)]">
          {T("Your cart is empty", "سلتك فاضية")}
        </h1>
        <p className="text-[var(--numu-ink-soft)]">
          {T("Add a product to see it here.", "ضيف منتج علشان يظهر هنا.")}
        </p>
      </div>
    );
  }

  return (
    <div dir={dir} className="mx-auto max-w-4xl p-4 text-[var(--numu-ink)] [font-family:var(--numu-sans)] md:p-8">
      <h1 className="mb-6 text-3xl font-bold text-[var(--numu-ink)] [font-family:var(--numu-display)]">
        {T("Cart", "السلة")}
      </h1>
      <ul className="divide-y divide-[var(--numu-border)]">
        {cart.items.map((li) => {
          const sold = li.sold_out_now;
          const priceChanged = Boolean(li.price_changed);
          return (
            <li key={li.id} className="py-4 flex gap-4">
              {li.image_url ? (
                <img
                  src={li.image_url}
                  alt={li.product_name || ""}
                  className="w-20 h-20 object-cover rounded"
                />
              ) : (
                <div className="w-20 h-20 rounded bg-[var(--numu-cream)]" />
              )}
              <div className="flex-1">
                <div className="font-medium">{li.product_name || "Item"}</div>
                {li.variant_name && (
                  <div className="text-sm text-[var(--numu-ink-soft)] mt-0.5">
                    {li.variant_name}
                  </div>
                )}
                {sold && (
                  <div className="text-sm text-red-600 mt-1">
                    Sold out — remove to continue.
                  </div>
                )}
                {priceChanged && !sold && li.current_price !== undefined && (
                  <div className="text-xs text-amber-700 mt-1">
                    Price changed since you added this — now{" "}
                    {fmtCents(li.current_price, currency)}.
                  </div>
                )}
                <div className="mt-2 flex items-center gap-3">
                  <div className="inline-flex overflow-hidden rounded-full border border-[var(--numu-border)]">
                    <button
                      type="button"
                      className="px-2 py-1 hover:bg-[var(--numu-cream)]"
                      onClick={() =>
                        updateQty(li.id, Math.max(1, li.quantity - 1))
                      }
                      aria-label="Decrease quantity"
                    >
                      −
                    </button>
                    <span className="min-w-[2rem] px-3 py-1 text-center">
                      {li.quantity}
                    </span>
                    <button
                      type="button"
                      className="px-2 py-1 hover:bg-[var(--numu-cream)]"
                      onClick={() => updateQty(li.id, li.quantity + 1)}
                      aria-label="Increase quantity"
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    className="text-sm text-[var(--numu-ink-soft)] hover:text-red-700"
                    onClick={() => removeItem(li.id)}
                  >
                    {T("Remove", "إزالة")}
                  </button>
                </div>
              </div>
              <div className="text-right">
                <div className="font-medium">
                  {fmtCents(li.total_price, currency)}
                </div>
                <div className="text-xs text-[var(--numu-ink-soft)]">
                  {fmtCents(li.unit_price, currency)} {T("each", "للوحدة")}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <PromoCartHints
        subtotalCents={cart.subtotal}
        currency={currency}
        locale={locale}
      />

      <div className="mt-6 border-t border-[var(--numu-border)] pt-4 space-y-2">
        <div className="flex justify-between text-sm">
          <span>{T("Subtotal", "الإجمالي الفرعي")}</span>
          <span>{fmtCents(cart.subtotal, currency)}</span>
        </div>
        {cart.applied_promotion && (
          <div className="flex justify-between text-sm text-green-700">
            <span>
              {cart.applied_promotion.label ||
                cart.applied_promotion.code ||
                "Discount"}
            </span>
            <span>−{fmtCents(cart.applied_promotion.amount, currency)}</span>
          </div>
        )}
        <div className="flex justify-between text-base font-semibold pt-2 border-t border-[var(--numu-border)]">
          <span>{T("Total", "الإجمالي")}</span>
          {/* Total must net off any applied promotion — it previously
              mirrored the subtotal, so a discounted cart showed the
              pre-discount amount as the Total. */}
          <span>
            {fmtCents(
              Math.max(
                0,
                cart.subtotal - (cart.applied_promotion?.amount ?? 0),
              ),
              currency,
            )}
          </span>
        </div>
        <p className="text-xs text-[var(--numu-ink-soft)] mt-2">
          {T(
            "Shipping, taxes, and any gift cards apply at checkout.",
            "الشحن والضرائب وكروت الهدايا بتتحسب عند الدفع.",
          )}
        </p>
      </div>

      <a
        href={checkoutUrl}
        className="numu-btn-navy mt-6 block rounded-full py-3 text-center font-semibold"
      >
        {T("Checkout", "إتمام الشراء")}
      </a>
    </div>
  );
}
