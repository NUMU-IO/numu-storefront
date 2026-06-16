"use client";

/**
 * Promotion popup (offers-v2 surface) — host-rendered overlay. Honors the
 * display trigger (on_load / on_delay / on_scroll_pct / on_exit_intent), an
 * optional email-capture form that reveals a discount code on submit, and
 * per-visitor dismissal. Mirrors V2's PopupModal, self-contained like
 * AnnouncementBar.
 */

import { useEffect, useRef, useState } from "react";
import type { ResolvedPromotion } from "@/lib/promo-server";
import {
  postPromo,
  submitPromoForm,
  isPromoDismissed,
  markPromoDismissed,
  pickBi,
} from "@/lib/promo-client";

interface PopupContent {
  image_url?: string | null;
  discount_code_to_reveal?: string | null;
  form_fields?: string[];
  show_after_dismiss_days?: number;
}
interface Display {
  trigger?: string;
  trigger_value?: { delay_ms?: number; scroll_pct?: number };
}

export function PopupModal({
  promotion,
  locale = "ar",
}: {
  promotion: ResolvedPromotion;
  locale?: string;
}) {
  const isAr = locale === "ar";
  const content = (promotion.content ?? {}) as PopupContent;
  const display = (promotion.display ?? {}) as Display;
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fired = useRef(false);

  useEffect(() => {
    if (isPromoDismissed(promotion.promotion_id)) return;
    const show = () => {
      if (fired.current) return;
      fired.current = true;
      setOpen(true);
      postPromo(promotion.promotion_id, "events", {
        event_type: "impression",
        metadata: { surface: "popup" },
      });
    };
    const trigger = display.trigger || "on_load";
    if (trigger === "on_delay") {
      const t = setTimeout(show, Number(display.trigger_value?.delay_ms) || 3000);
      return () => clearTimeout(t);
    }
    if (trigger === "on_scroll_pct") {
      const target = Number(display.trigger_value?.scroll_pct) || 50;
      const onScroll = () => {
        const max = document.body.scrollHeight - window.innerHeight || 1;
        if ((window.scrollY / max) * 100 >= target) show();
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => window.removeEventListener("scroll", onScroll);
    }
    if (trigger === "on_exit_intent") {
      const onLeave = (e: MouseEvent) => {
        if (e.clientY <= 0) show();
      };
      document.addEventListener("mouseout", onLeave);
      return () => document.removeEventListener("mouseout", onLeave);
    }
    show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!open) return null;

  const headline = pickBi(promotion.translated_content, "headline", isAr);
  const body = pickBi(promotion.translated_content, "body", isAr);
  const ctaLabel = pickBi(promotion.translated_content, "cta_label", isAr);
  const ctaUrl = (promotion.translated_content as { cta_url?: string })?.cta_url;
  const wantsEmail =
    Array.isArray(content.form_fields) && content.form_fields.includes("email");
  const code =
    revealed ?? content.discount_code_to_reveal ?? promotion.coupon_code ?? null;

  const close = () => {
    const days = content.show_after_dismiss_days ?? 30;
    postPromo(promotion.promotion_id, "events", {
      event_type: "dismiss",
      metadata: { surface: "popup" },
    });
    postPromo(promotion.promotion_id, "dismiss", { remember_for_days: days });
    markPromoDismissed(promotion.promotion_id, days);
    setOpen(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || busy) return;
    setBusy(true);
    const out = await submitPromoForm(promotion.promotion_id, {
      email,
      accepts_marketing: true,
    });
    setBusy(false);
    setRevealed(out?.discount_code ?? content.discount_code_to_reveal ?? "");
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      dir={isAr ? "rtl" : "ltr"}
    >
      <div className="absolute inset-0 bg-black/50" onClick={close} aria-hidden />
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute end-3 top-3 z-10 rounded-full bg-white/80 p-1.5 text-gray-500 hover:bg-gray-100"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
        {content.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={content.image_url} alt="" className="h-40 w-full object-cover" />
        )}
        <div className="p-6 text-center">
          {headline && (
            <h2 className="mb-2 text-xl font-semibold text-gray-900">{headline}</h2>
          )}
          {body && <p className="mb-4 text-sm text-gray-600">{body}</p>}
          {code ? (
            <div className="mb-1 rounded-lg border border-dashed border-emerald-300 bg-emerald-50 px-4 py-3">
              <p className="text-xs text-emerald-700">
                {isAr ? "كود الخصم" : "Your code"}
              </p>
              <p className="select-all font-mono text-lg font-bold text-emerald-800" dir="ltr">
                {code}
              </p>
            </div>
          ) : wantsEmail ? (
            <form onSubmit={submit} className="space-y-2">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={isAr ? "البريد الإلكتروني" : "Email"}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                dir="ltr"
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {busy ? "…" : ctaLabel || (isAr ? "اشترك" : "Subscribe")}
              </button>
            </form>
          ) : ctaUrl ? (
            <a
              href={ctaUrl}
              onClick={() =>
                postPromo(promotion.promotion_id, "events", {
                  event_type: "click",
                  metadata: { surface: "popup" },
                })
              }
              className="inline-block rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
            >
              {ctaLabel || (isAr ? "تسوّق الآن" : "Shop now")}
            </a>
          ) : null}
        </div>
      </div>
    </div>
  );
}
