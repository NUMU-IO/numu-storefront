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

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { ResolvedPromotion } from "@/lib/promo-server";
import { postPromo } from "@/lib/promo-client";
import { CONSENT_CHANGED_EVENT } from "@/lib/consent";

// Must stay in sync with the same constant in lib/consent.ts, which is what
// the pixel gate reads.
const CONSENT_KEY = "numu_cookie_consent_v1";

interface CookieContent {
  accept_required?: boolean;
  policy_url?: string | null;
}

/**
 * The merchant's copy for the ACTIVE locale ONLY — deliberately not `pickBi`.
 *
 * The shared helper answers `en ?? ar` (and `ar ?? en`), and that cross-language
 * fallback is what put Arabic consent copy on `lang="en"` pages: promotions in
 * the wild carry `headline.ar` / `body.ar` and no English at all, so every
 * English visitor was handed the Arabic. Cross-falling back is right for a
 * marketing headline — some copy beats none — but this is the notice a shopper
 * is asked to consent to, and text in a language they may not read is worse
 * than the platform's own translated default below. So an unauthored language
 * resolves to "" and the default takes over; a merchant who wrote only Arabic
 * still serves it to Arabic visitors, and one who wrote both keeps both.
 */
function authoredCopy(
  tx: Record<string, unknown> | undefined,
  field: string,
  isAr: boolean,
): string {
  const f = tx?.[field] as { ar?: string; en?: string } | undefined;
  return ((isAr ? f?.ar : f?.en) ?? "").toString();
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
  const content = (promotion.content ?? {}) as CookieContent;
  const [show, setShow] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);
  // Seeded from the SSR prop, then corrected against the document below.
  const [isAr, setIsAr] = useState(locale === "ar");

  useEffect(() => {
    // Locale: read `<html lang>`, the same signal every checkout step uses
    // (ContactStep, ShippingStep, PaymentStep, ReviewStep, TrackLookup …).
    //
    // The `locale` prop reaches this component by a DIFFERENT route than the
    // `lang` attribute does, and the two can disagree: with no visitor locale
    // override the root layout falls back to the store's `default_language`,
    // while [domain]/layout.tsx collapses that same absent override to "en" for
    // the promo surfaces — so on an Arabic-default store the page is `lang="ar"`
    // and this banner was handed "en". The document is what the visitor is
    // actually being served, so it wins; and because the banner stays hidden
    // until this effect runs, the corrected copy is the only copy ever painted.
    if (typeof document !== "undefined") {
      setIsAr(document.documentElement.lang === "ar");
    }
    if (!hasConsent()) {
      setShow(true);
      postPromo(promotion.promotion_id, "events", {
        event_type: "impression",
        metadata: { surface: "cookie_banner" },
      });
    }
  }, [promotion.promotion_id]);

  /**
   * Reserve the banner's height at the foot of the document while it is shown.
   *
   * The banner is `position: fixed` at the bottom of the viewport, so it takes
   * no space in flow and silently covers whatever the page put there — measured
   * on /track, it sat over the "Continue shopping" link, i.e. an interactive
   * element the shopper could neither see nor click. Raising z-index or moving
   * the card can't fix that; only giving the document somewhere to end can.
   *
   * Padding on <body> is the one lever that works for every page at once
   * (theme-rendered and host-rendered alike). With the border-box sizing
   * Tailwind's preflight applies, it also counts inside the `min-height: 100svh`
   * that globals.css puts on <body>, so a short page shrinks to make room
   * instead of gaining a scrollbar. Measured (the outer fixed element, so its
   * own gutter counts) rather than hardcoded: the card reflows from one row to a
   * stacked column below `sm`, and its copy is merchant-authored, so its height
   * is not a constant. Restored on cleanup — same save/restore shape as
   * LocationDialog's scroll lock.
   */
  useEffect(() => {
    const banner = bannerRef.current;
    if (!show || !banner) return;
    const previousPadding = document.body.style.paddingBottom;
    const reserve = () => {
      document.body.style.paddingBottom = `${banner.offsetHeight}px`;
    };
    reserve();
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(reserve) : null;
    observer?.observe(banner);
    return () => {
      observer?.disconnect();
      document.body.style.paddingBottom = previousPadding;
    };
  }, [show]);

  if (!show) return null;

  const headline =
    authoredCopy(promotion.translated_content, "headline", isAr) ||
    (isAr ? "نحن نحترم خصوصيتك" : "We value your privacy");
  const body =
    authoredCopy(promotion.translated_content, "body", isAr) ||
    (isAr
      ? "بنستخدم الكوكيز لتحسين تجربتك في التصفّح وعرض محتوى مناسب ليك وتحليل أداء المتجر."
      : "We use cookies to improve your browsing experience, show relevant content, and analyze our store's performance.");
  const policyUrl = content.policy_url || "/policies/privacy";

  const decide = (decision: "accepted" | "rejected") => {
    saveConsent(decision);
    // Tell <ConsentGate> so the tracking pixels mount the moment the visitor
    // accepts, rather than only on their next page load. Purely additive —
    // nothing breaks if no gate is listening.
    try {
      window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
    } catch {
      /* ignore */
    }
    postPromo(promotion.promotion_id, "events", {
      event_type: decision === "accepted" ? "click" : "dismiss",
      metadata: { surface: "cookie_banner", decision },
    });
    postPromo(promotion.promotion_id, "dismiss", { remember_for_days: 365 });
    setShow(false);
  };

  return (
    <div
      ref={bannerRef}
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
