"use client";

/**
 * Built-in product detail page — used when a store has no PDP
 * template configured (vanilla bazar theme, freshly-onboarded stores)
 * AND no BYOT bundle. This used to be a dead-end three-line fallback;
 * it now ships a Shopify-grade variant picker + qty + add-to-cart so
 * "everything works e-e" holds even with zero theme customization.
 *
 * Designed to be self-contained: no SDK context dependency, no
 * NuMuProvider wrapping. Talks to `/api/cart/add` directly the same
 * way the SDK's NuMuProvider does.
 */

import { useEffect, useMemo, useState } from "react";
import { ShareButtons } from "./ShareButtons";

interface ProductVariant {
  id: string;
  option_values?: Record<string, string>;
  options?: Record<string, string>;
  price: string | number;
  price_currency?: string;
  compare_at_price?: string | number | null;
  sku?: string | null;
  inventory_quantity?: number;
  is_in_stock?: boolean;
  in_stock?: boolean;
  image_url?: string | null;
}

interface ProductOption {
  name: string;
  position?: number;
  values?: string[];
}

interface Product {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  currency?: string;
  compare_at_price?: number | null;
  in_stock?: boolean;
  is_in_stock?: boolean;
  quantity?: number;
  images?: Array<{ url: string; alt?: string }>;
  options?: ProductOption[];
  variants?: ProductVariant[];
}

interface Props {
  product: Product;
}

/** Find the variant matching the current axis selection. */
function findVariant(
  variants: ProductVariant[],
  selection: Record<string, string>,
): ProductVariant | null {
  for (const v of variants) {
    const opts = v.option_values || v.options || {};
    const matches = Object.entries(selection).every(
      ([axis, value]) => opts[axis] === value,
    );
    if (matches && Object.keys(selection).length === Object.keys(opts).length) {
      return v;
    }
  }
  return null;
}

/** Per-axis: which values currently lead to at least one matching variant. */
function availableValues(
  variants: ProductVariant[],
  options: ProductOption[],
  selection: Record<string, string>,
): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const axis of options) {
    out[axis.name] = new Set();
    for (const v of variants) {
      const opts = v.option_values || v.options || {};
      const compatible = Object.entries(selection).every(
        ([k, val]) => k === axis.name || opts[k] === val,
      );
      if (compatible && opts[axis.name]) {
        out[axis.name].add(opts[axis.name]);
      }
    }
  }
  return out;
}

function readCsrfCookie(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.match(/(?:^|; )numu_csrf=([^;]+)/)?.[1] ?? "";
}

export default function BuiltInProductDetail({ product }: Props) {
  const variants = product.variants || [];
  const options = product.options || [];
  const hasVariants = variants.length > 0 && options.length > 0;

  // Auto-select default variant's axes on mount.
  const initial = useMemo<Record<string, string>>(() => {
    if (!hasVariants) return {};
    const dv =
      variants.find((v) => v.is_in_stock ?? v.in_stock) || variants[0];
    return { ...(dv?.option_values || dv?.options || {}) };
  }, [variants, hasVariants]);

  const [selection, setSelection] = useState<Record<string, string>>(initial);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  const variant = hasVariants ? findVariant(variants, selection) : null;
  const availability = useMemo(
    () => availableValues(variants, options, selection),
    [variants, options, selection],
  );

  const displayPriceNum = hasVariants
    ? variant
      ? Number(variant.price)
      : Number(variants[0].price)
    : product.price;
  const displayCompareAt = hasVariants
    ? variant?.compare_at_price
      ? Number(variant.compare_at_price)
      : null
    : product.compare_at_price ?? null;
  const displayImage = variant?.image_url || product.images?.[0]?.url || null;
  const inStock = hasVariants
    ? variant
      ? (variant.is_in_stock ?? variant.in_stock ?? false)
      : false
    : (product.in_stock ?? product.is_in_stock ?? true);
  const isComplete = hasVariants
    ? options.every((a) => Boolean(selection[a.name]))
    : true;
  const canAdd = inStock && isComplete && !busy;

  // Dismiss success/error messages after 2.5s so the page doesn't get
  // littered with stale notices.
  useEffect(() => {
    if (!msg) return;
    const id = window.setTimeout(() => setMsg(null), 2500);
    return () => window.clearTimeout(id);
  }, [msg]);

  async function handleAdd() {
    if (!canAdd) return;
    setBusy(true);
    setMsg(null);
    try {
      const csrf = readCsrfCookie();
      const res = await fetch("/api/cart/add", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrf ? { "x-numu-csrf": csrf } : {}),
          "x-numu-idempotency-key": crypto.randomUUID(),
        },
        credentials: "include",
        body: JSON.stringify({
          product_id: product.id,
          variant_id: variant?.id,
          quantity: qty,
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        setMsg({
          kind: "err",
          text:
            res.status === 409
              ? "That item is out of stock right now."
              : `Couldn't add — ${txt || res.statusText}`,
        });
        return;
      }
      setMsg({ kind: "ok", text: "Added to cart." });
      // Notify any cart drawer listeners (non-React themes consume this).
      window.dispatchEvent(new CustomEvent("numu:cart:updated"));
    } catch (err) {
      setMsg({
        kind: "err",
        text: err instanceof Error ? err.message : "Couldn't add.",
      });
    } finally {
      setBusy(false);
    }
  }

  const currency = product.currency || variant?.price_currency || "EGP";

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
      <div className="bg-gray-50 rounded-lg overflow-hidden">
        {displayImage ? (
          <img
            src={displayImage}
            alt={product.name}
            className="w-full h-auto object-cover"
          />
        ) : (
          <div className="aspect-square flex items-center justify-center text-gray-300">
            No image
          </div>
        )}
      </div>
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold">{product.name}</h1>
        <div className="mt-3 flex items-baseline gap-3">
          <span className="text-2xl font-bold">
            {displayPriceNum.toFixed(2)} {currency}
          </span>
          {displayCompareAt && displayCompareAt > displayPriceNum && (
            <span className="text-base text-gray-400 line-through">
              {Number(displayCompareAt).toFixed(2)} {currency}
            </span>
          )}
        </div>
        {product.description && (
          <p className="mt-4 text-gray-600 whitespace-pre-line">
            {product.description}
          </p>
        )}

        {hasVariants &&
          options.map((axis) => {
            const values = axis.values || [];
            const allowed = availability[axis.name] ?? new Set<string>();
            return (
              <div key={axis.name} className="mt-5">
                <label className="block text-sm font-medium mb-2">
                  {axis.name}
                  {selection[axis.name] && (
                    <span className="ml-2 text-gray-500 font-normal">
                      : {selection[axis.name]}
                    </span>
                  )}
                </label>
                <div className="flex flex-wrap gap-2">
                  {values.map((v) => {
                    const active = selection[axis.name] === v;
                    const disabled = !allowed.has(v) && !active;
                    return (
                      <button
                        key={v}
                        type="button"
                        disabled={disabled}
                        onClick={() =>
                          setSelection((s) => ({ ...s, [axis.name]: v }))
                        }
                        className={[
                          "px-3 py-1.5 text-sm rounded-md border transition",
                          active
                            ? "border-black bg-black text-white"
                            : "border-gray-300 hover:border-gray-500",
                          disabled
                            ? "opacity-40 cursor-not-allowed line-through"
                            : "",
                        ].join(" ")}
                      >
                        {v}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

        <div className="mt-5 flex items-center gap-3">
          <label className="text-sm font-medium">Qty</label>
          <div className="inline-flex border border-gray-300 rounded-md overflow-hidden">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(1, q - 1))}
              className="px-3 py-1.5 hover:bg-gray-50"
              aria-label="Decrease quantity"
            >
              −
            </button>
            <span className="px-3 py-1.5 min-w-[2.5rem] text-center">{qty}</span>
            <button
              type="button"
              onClick={() => setQty((q) => q + 1)}
              className="px-3 py-1.5 hover:bg-gray-50"
              aria-label="Increase quantity"
            >
              +
            </button>
          </div>
        </div>

        <button
          type="button"
          disabled={!canAdd}
          onClick={handleAdd}
          aria-busy={busy}
          className={[
            "mt-6 w-full py-3 rounded-md font-medium transition",
            canAdd
              ? "bg-black text-white hover:bg-gray-800"
              : "bg-gray-200 text-gray-500 cursor-not-allowed",
          ].join(" ")}
        >
          {busy
            ? "Adding…"
            : !isComplete
              ? "Choose options"
              : !inStock
                ? "Sold out"
                : "Add to cart"}
        </button>

        {msg && (
          <div
            role="status"
            className={[
              "mt-3 text-sm",
              msg.kind === "ok" ? "text-green-700" : "text-red-700",
            ].join(" ")}
          >
            {msg.text}
          </div>
        )}

        {/* Feature 001 US4 — auto-tagged customer-share buttons. */}
        <ShareButtons title={product.name} className="mt-6" />
      </div>
    </div>
  );
}
