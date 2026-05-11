"use client";

/**
 * Reorder button — Phase 8.5.
 *
 * Drops every line from a past order into the current cart and
 * surfaces the per-line skip reasons (deleted, archived, out of
 * stock, variant unavailable) so the customer knows which items
 * didn't make it across.
 */

import { useState } from "react";

interface Props {
  orderId: string;
  cartUrl?: string;
}

type SkipReason =
  | "product_deleted"
  | "product_archived"
  | "out_of_stock"
  | "variant_unavailable";

interface Skipped {
  product_id: string;
  variant_id: string | null;
  quantity: number;
  reason: SkipReason | string;
  product_name?: string;
}

interface Result {
  added_count: number;
  skipped: Skipped[];
  cart_total_items: number;
}

function readCsrf(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.match(/(?:^|; )numu_csrf=([^;]+)/)?.[1] ?? "";
}

function reasonLabel(reason: string): string {
  switch (reason) {
    case "product_deleted":
      return "Product no longer available";
    case "product_archived":
      return "Product archived";
    case "out_of_stock":
      return "Out of stock";
    case "variant_unavailable":
      return "Variant no longer offered";
    default:
      return reason;
  }
}

export default function ReorderButton({
  orderId,
  cartUrl = "/cart",
}: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const csrf = readCsrf();
      const res = await fetch(
        `/api/customer/orders/${encodeURIComponent(orderId)}/reorder`,
        {
          method: "POST",
          headers: csrf ? { "x-numu-csrf": csrf } : {},
          credentials: "include",
        },
      );
      if (!res.ok) {
        if (res.status === 401) setError("Please sign in to reorder.");
        else if (res.status === 404)
          setError("That order can't be found on your account.");
        else setError(`Couldn't reorder (HTTP ${res.status}).`);
        return;
      }
      const json = await res.json();
      const data = (json?.data ?? json) as Result;
      setResult(data);
      // Notify any cart drawer listeners.
      window.dispatchEvent(new CustomEvent("numu:cart:updated"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reorder.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className={[
          "px-4 py-2 rounded-md font-medium transition",
          busy
            ? "bg-gray-200 text-gray-500 cursor-not-allowed"
            : "bg-black text-white hover:bg-gray-800",
        ].join(" ")}
      >
        {busy ? "Adding…" : "Reorder"}
      </button>

      {result && (
        <div className="mt-3 rounded-md border border-gray-200 p-3 text-sm">
          {result.added_count > 0 ? (
            <p>
              Added {result.added_count} item
              {result.added_count === 1 ? "" : "s"} back to your cart.{" "}
              <a href={cartUrl} className="underline">
                Go to cart →
              </a>
            </p>
          ) : (
            <p className="text-amber-700">
              Couldn&apos;t add any items — see below.
            </p>
          )}
          {result.skipped.length > 0 && (
            <ul className="mt-2 text-xs text-gray-600 space-y-1">
              {result.skipped.map((s, i) => (
                <li key={`${s.product_id}-${i}`}>
                  • {s.product_name || s.product_id.slice(0, 8)} ×{s.quantity}{" "}
                  — {reasonLabel(s.reason)}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <div className="mt-3 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
