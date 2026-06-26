"use client";

/**
 * Cart/checkout promotion hints (offers-v2 display layer) — host-rendered so
 * the built-in checkout summary + built-in cart show automatic offers and a
 * free-shipping progress bar without any per-theme code. Fed by the store's
 * active `auto_discounts` (GET /api/storefront/promotions). The actual offer
 * amount is applied at order time; this surfaces the offers + progress so a
 * shopper sees them BEFORE checkout (the V2 AppliedAutoDiscounts +
 * PromoFreeShippingHint behavior).
 */

import { useEffect, useState } from "react";
import { formatCents } from "@/lib/money";
import type { ResolvedPromotion } from "@/lib/promo-server";

interface Rule {
  kind?: string;
  value_percent?: number | null;
  value_cents?: number | null;
  min_subtotal_cents?: number | null;
}

interface PromoTx {
  label?: { ar?: string; en?: string };
  headline?: { ar?: string; en?: string };
}

/** Friendly one-liner for an automatic offer — merchant copy wins, else a
 *  rule-derived description (mirrors V2's describeRule). */
function describeRule(p: ResolvedPromotion, isAr: boolean): string {
  const tx = p.translated_content as PromoTx | undefined;
  const merchant = isAr
    ? tx?.label?.ar ?? tx?.headline?.ar
    : tx?.label?.en ?? tx?.headline?.en;
  if (merchant) return merchant;
  const r = (p.discount_rule ?? {}) as Rule;
  switch (r.kind) {
    case "percentage":
      return isAr
        ? `${r.value_percent ?? 0}% خصم تلقائي`
        : `${r.value_percent ?? 0}% off automatically`;
    case "fixed":
      return isAr
        ? `${Math.round((r.value_cents ?? 0) / 100)} ج.م خصم تلقائي`
        : `${Math.round((r.value_cents ?? 0) / 100)} off automatically`;
    case "free_shipping":
      return isAr ? "شحن مجاني" : "Free shipping";
    case "bogo":
      return isAr ? "اشترِ واحدًا واحصل على آخر" : "Buy one, get one";
    case "tiered":
      return isAr ? "خصومات متدرّجة" : "Tiered savings";
    default:
      return isAr ? "عرض خاص" : "Special offer";
  }
}

export function PromoCartHints({
  subtotalCents,
  currency = "EGP",
  locale = "en",
}: {
  subtotalCents: number;
  currency?: string;
  locale?: string;
}) {
  const isAr = locale === "ar";
  const [auto, setAuto] = useState<ResolvedPromotion[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/storefront/promotions?locale=${isAr ? "ar" : "en"}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const json = await res.json();
        const data = json?.data ?? json;
        if (!cancelled) {
          setAuto(Array.isArray(data?.auto_discounts) ? data.auto_discounts : []);
        }
      } catch {
        /* best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAr]);

  if (!auto || auto.length === 0) return null;

  // Free-shipping progress — the first free_shipping rule that has a threshold.
  const fs = auto.find((p) => {
    const r = p.discount_rule as Rule | null;
    return r?.kind === "free_shipping" && !!r.min_subtotal_cents;
  });
  const threshold = fs ? Number((fs.discount_rule as Rule).min_subtotal_cents) : 0;
  const remaining = threshold - subtotalCents;
  const pct =
    threshold > 0 ? Math.min(100, Math.round((subtotalCents / threshold) * 100)) : 0;

  // Every other automatic offer → a small "active" badge.
  const badges = auto.filter((p) => p !== fs);

  return (
    <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
      {fs && threshold > 0 && (
        <div className="rounded-lg bg-emerald-50 px-3 py-2">
          <p className="text-xs font-medium text-emerald-800">
            {remaining > 0
              ? isAr
                ? `أضف ${formatCents(remaining, currency)} للحصول على شحن مجاني`
                : `Add ${formatCents(remaining, currency)} for free shipping`
              : isAr
                ? "🎉 حصلت على شحن مجاني!"
                : "🎉 You've unlocked free shipping!"}
          </p>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-emerald-100">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${remaining > 0 ? pct : 100}%` }}
            />
          </div>
        </div>
      )}
      {badges.length > 0 && (
        <ul className="space-y-1">
          {badges.map((p, i) => (
            <li
              key={p.promotion_id || i}
              className="flex items-center gap-1.5 text-xs text-emerald-700"
            >
              <svg
                width="13"
                height="13"
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
              <span>{describeRule(p, isAr)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
