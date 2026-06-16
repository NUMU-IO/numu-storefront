"use client";

/**
 * Cookie-consent banner (offers-v2 surface) — host-rendered. Stores the
 * visitor's decision in localStorage for a year and suppresses re-show.
 * Self-contained like AnnouncementBar.
 */

import { useEffect, useState } from "react";
import type { ResolvedPromotion } from "@/lib/promo-server";
import { postPromo, pickBi } from "@/lib/promo-client";

const CONSENT_KEY = "numu_cookie_consent_v1";

interface CookieContent {
  accept_required?: boolean;
  policy_url?: string | null;
}

function hasConsent(): boolean {
  try {
    return !!localStorage.getItem(CONSENT_KEY);
  } catch {
    return false;
  }
}
function saveConsent(decision: string): void {
  try {
    localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({ decision, ts: Date.now() }),
    );
  } catch {
    /* ignore */
  }
}

export function CookieBanner({
  promotion,
  locale = "ar",
}: {
  promotion: ResolvedPromotion;
  locale?: string;
}) {
  const isAr = locale === "ar";
  const content = (promotion.content ?? {}) as CookieContent;
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!hasConsent()) {
      setShow(true);
      postPromo(promotion.promotion_id, "events", {
        event_type: "impression",
        metadata: { surface: "cookie_banner" },
      });
    }
  }, [promotion.promotion_id]);

  if (!show) return null;

  const headline = pickBi(promotion.translated_content, "headline", isAr);
  const body =
    pickBi(promotion.translated_content, "body", isAr) ||
    (isAr
      ? "بنستخدم الكوكيز لتحسين تجربتك."
      : "We use cookies to improve your experience.");
  const policyUrl = content.policy_url || "/policies/privacy";

  const decide = (decision: "accepted" | "rejected") => {
    saveConsent(decision);
    postPromo(promotion.promotion_id, "events", {
      event_type: decision === "accepted" ? "click" : "dismiss",
      metadata: { surface: "cookie_banner", decision },
    });
    postPromo(promotion.promotion_id, "dismiss", { remember_for_days: 365 });
    setShow(false);
  };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-[200] border-t border-gray-200 bg-white/95 p-4 shadow-lg backdrop-blur"
      role="region"
      aria-label="Cookie consent"
      dir={isAr ? "rtl" : "ltr"}
    >
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-3 sm:flex-row">
        <p className="flex-1 text-xs text-gray-600">
          {headline && (
            <span className="font-medium text-gray-800">{headline} </span>
          )}
          {body}{" "}
          <a href={policyUrl} className="underline hover:text-gray-900">
            {isAr ? "سياسة الخصوصية" : "Privacy policy"}
          </a>
        </p>
        <div className="flex shrink-0 gap-2">
          {!content.accept_required && (
            <button
              type="button"
              onClick={() => decide("rejected")}
              className="rounded-lg border border-gray-300 px-4 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {isAr ? "رفض" : "Reject"}
            </button>
          )}
          <button
            type="button"
            onClick={() => decide("accepted")}
            className="rounded-lg bg-gray-900 px-4 py-1.5 text-xs font-semibold text-white hover:bg-gray-800"
          >
            {isAr ? "موافق" : "Accept"}
          </button>
        </div>
      </div>
    </div>
  );
}
