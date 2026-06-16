"use client";

/**
 * Floating promo widget (offers-v2 surface) — a corner pill that expands to a
 * card. Hidden when a popup is also active (one attention sink at a time).
 * Self-contained like AnnouncementBar.
 */

import { useEffect, useRef, useState } from "react";
import type { ResolvedPromotion } from "@/lib/promo-server";
import {
  postPromo,
  isPromoDismissed,
  markPromoDismissed,
  pickBi,
} from "@/lib/promo-client";

interface WidgetContent {
  position?: string;
  expanded_default?: boolean;
  color_bg?: string;
}

const POS: Record<string, string> = {
  "bottom-right": "bottom-4 end-4",
  "bottom-left": "bottom-4 start-4",
  "top-right": "top-20 end-4",
  "top-left": "top-20 start-4",
};

export function FloatingWidget({
  promotion,
  popupCount = 0,
  locale = "ar",
}: {
  promotion: ResolvedPromotion;
  popupCount?: number;
  locale?: string;
}) {
  const isAr = locale === "ar";
  const content = (promotion.content ?? {}) as WidgetContent;
  const [hidden, setHidden] = useState(true);
  const [expanded, setExpanded] = useState(!!content.expanded_default);
  const fired = useRef(false);

  useEffect(() => {
    if (!isPromoDismissed(promotion.promotion_id)) setHidden(false);
  }, [promotion.promotion_id]);

  useEffect(() => {
    if (!hidden && !fired.current) {
      fired.current = true;
      postPromo(promotion.promotion_id, "events", {
        event_type: "impression",
        metadata: { surface: "floating_widget" },
      });
    }
  }, [hidden, promotion.promotion_id]);

  if (hidden || popupCount > 0) return null;

  const headline = pickBi(promotion.translated_content, "headline", isAr);
  const body = pickBi(promotion.translated_content, "body", isAr);
  const ctaLabel = pickBi(promotion.translated_content, "cta_label", isAr);
  const ctaUrl = (promotion.translated_content as { cta_url?: string })?.cta_url;
  const pos = POS[content.position || "bottom-right"] || POS["bottom-right"];
  const bg = content.color_bg || "#111827";

  const dismiss = () => {
    postPromo(promotion.promotion_id, "events", {
      event_type: "dismiss",
      metadata: { surface: "floating_widget" },
    });
    postPromo(promotion.promotion_id, "dismiss", { remember_for_days: 30 });
    markPromoDismissed(promotion.promotion_id);
    setHidden(true);
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className={`fixed z-[60] ${pos} flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-white shadow-lg`}
        style={{ backgroundColor: bg }}
        dir={isAr ? "rtl" : "ltr"}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7.5 4.27 9 5.15" /><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /></svg>
        <span className="max-w-[12rem] truncate">
          {headline || (isAr ? "عرض خاص" : "Special offer")}
        </span>
      </button>
    );
  }

  return (
    <div
      className={`fixed z-[60] ${pos} w-72 rounded-2xl bg-white p-4 shadow-xl ring-1 ring-black/5`}
      dir={isAr ? "rtl" : "ltr"}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Close"
        className="absolute end-2 top-2 rounded-full p-1 text-gray-400 hover:bg-gray-100"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
      </button>
      {headline && (
        <p className="mb-1 pe-5 text-sm font-semibold text-gray-900">{headline}</p>
      )}
      {body && <p className="mb-3 text-xs text-gray-600">{body}</p>}
      {ctaUrl && (
        <a
          href={ctaUrl}
          onClick={() =>
            postPromo(promotion.promotion_id, "events", {
              event_type: "click",
              metadata: { surface: "floating_widget" },
            })
          }
          className="block rounded-lg px-3 py-2 text-center text-sm font-semibold text-white"
          style={{ backgroundColor: bg }}
        >
          {ctaLabel || (isAr ? "تسوّق الآن" : "Shop now")}
        </a>
      )}
    </div>
  );
}
