"use client";

/**
 * Cookie-consent banner (offers-v2 surface) — host-rendered. Stores the
 * visitor's decision in localStorage for a year and suppresses re-show.
 * Self-contained like AnnouncementBar.
 *
 * Design: a professional, self-contained consent card pinned to the bottom
 * of the viewport (not a thin full-bleed strip). It adopts the active theme's
 * brand palette via the `--ck-*` tokens the layout passes in (bazar →
 * cream surface / ink text / amber Accept), with a prominent primary Accept
 * action and a quieter Reject. Falls back to a neutral light card when the
 * store has no brand colours.
 */

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
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

function CookieIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2a10 10 0 1 0 10 10 4 4 0 0 1-5-5 4 4 0 0 1-5-5" />
      <path d="M8.5 8.5v.01" />
      <path d="M16 15.5v.01" />
      <path d="M12 12v.01" />
      <path d="M11 17v.01" />
      <path d="M7 14v.01" />
    </svg>
  );
}

export function CookieBanner({
  promotion,
  locale = "ar",
  brandVars,
}: {
  promotion: ResolvedPromotion;
  locale?: string;
  /** `--ck-*` brand tokens from the active theme so the banner matches the
   *  store (amber/cream for bazar). Optional — falls back to neutral. */
  brandVars?: Record<string, string>;
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

  const headline =
    pickBi(promotion.translated_content, "headline", isAr) ||
    (isAr ? "نحن نحترم خصوصيتك" : "We value your privacy");
  const body =
    pickBi(promotion.translated_content, "body", isAr) ||
    (isAr
      ? "بنستخدم الكوكيز لتحسين تجربتك في التصفّح وعرض محتوى مناسب ليك وتحليل أداء المتجر."
      : "We use cookies to improve your browsing experience, show relevant content, and analyze our store's performance.");
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
      className="fixed inset-x-0 bottom-0 z-[200] p-3 sm:p-4"
      role="region"
      aria-label={isAr ? "موافقة ملفات تعريف الارتباط" : "Cookie consent"}
      dir={isAr ? "rtl" : "ltr"}
      style={brandVars as CSSProperties | undefined}
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-4 rounded-[var(--ck-radius,1rem)] border-[length:var(--ck-frame-width,1px)] border-[var(--ck-frame,rgba(0,0,0,0.12))] bg-[var(--ck-surface,#fff)] p-4 text-[var(--ck-fg,#111827)] shadow-[0_12px_40px_-12px_rgba(0,0,0,0.35)] [font-family:var(--ck-body-font)] sm:flex-row sm:items-center sm:gap-5 sm:p-5">
        {/* Icon + copy stay grouped on mobile; `sm:contents` dissolves this
            wrapper at ≥sm so icon, copy and actions sit in one row. */}
        <div className="flex items-center gap-3 sm:contents">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--ck-accent-tint,#f3f4f6)] text-[var(--ck-accent,#111827)]">
            <CookieIcon />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-[var(--ck-fg,#111827)] [font-family:var(--ck-heading-font)] [font-weight:var(--ck-heading-weight,700)] [letter-spacing:var(--ck-heading-tracking)] [text-transform:var(--ck-heading-transform)]">
              {headline}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--ck-muted,#6b7280)]">
              {body}{" "}
              <a
                href={policyUrl}
                className="font-medium text-[var(--ck-accent,#111827)] underline underline-offset-2 hover:opacity-80"
              >
                {isAr ? "سياسة الخصوصية" : "Privacy policy"}
              </a>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2.5 max-sm:w-full">
          {!content.accept_required && (
            <button
              type="button"
              onClick={() => decide("rejected")}
              className="inline-flex min-h-10 items-center justify-center rounded-full border-[length:var(--ck-frame-width,1px)] border-[var(--ck-frame,#d1d5db)] px-5 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--ck-fg,#374151)] transition-colors hover:bg-[var(--ck-surface-2,#f9fafb)] max-sm:flex-1"
            >
              {isAr ? "رفض" : "Reject"}
            </button>
          )}
          <button
            type="button"
            onClick={() => decide("accepted")}
            className="inline-flex min-h-10 items-center justify-center rounded-full bg-[var(--ck-button,#111827)] px-6 py-2 text-xs font-bold uppercase tracking-wide text-[var(--ck-button-text,#fff)] transition-[filter] hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ck-ring,#111827)] max-sm:flex-1"
          >
            {isAr ? "موافق" : "Accept"}
          </button>
        </div>
      </div>
    </div>
  );
}
