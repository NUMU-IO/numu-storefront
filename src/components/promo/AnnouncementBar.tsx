"use client";

/**
 * Customer-facing announcement bar (offers-v2 surface) — host-rendered so it
 * shows for built-in AND BYOT themes with no per-theme code (mirrors the
 * <MetaPixel> approach). Ported from numu-egyptian-bazaar's AnnouncementBar,
 * made self-contained: the SSR layout passes the resolved promotion as a prop
 * and this component handles impression/click/dismiss via the host proxy
 * (/api/storefront/promotions/{id}/{events,dismiss}) + a localStorage marker.
 *
 * Background/text colors come straight from the merchant's `content` (decoupled
 * from the theme palette, by design). Rendered in normal flow at the very top
 * of the shell so it pushes the theme's header down rather than overlapping it.
 */

import { useEffect, useRef, useState } from "react";
import type { ResolvedPromotion } from "@/lib/promo-server";

interface AnnouncementContent {
  background?: string;
  text_color?: string;
  dismissible?: boolean;
  link_url?: string | null;
}
interface AnnouncementTranslations {
  headline?: { ar?: string; en?: string };
  body?: { ar?: string; en?: string };
  cta_url?: string;
}

function pick(
  promo: ResolvedPromotion,
  field: "headline" | "body",
  locale: string,
): string {
  const tx = promo.translated_content as AnnouncementTranslations | undefined;
  const f = tx?.[field];
  if (!f) return "";
  return ((locale === "ar" ? f.ar ?? f.en : f.en ?? f.ar) ?? "").toString();
}

function post(promotionId: string, action: string, body: unknown): void {
  void fetch(`/api/storefront/promotions/${promotionId}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}

export function AnnouncementBar({
  promotion,
  locale = "ar",
}: {
  promotion: ResolvedPromotion;
  locale?: string;
}) {
  const content = (promotion.content ?? {}) as AnnouncementContent;
  const [open, setOpen] = useState(true);
  const impressionFired = useRef(false);
  const dismissKey = `numu_promo_dismissed_${promotion.promotion_id}`;

  // Client-side dismissal suppression + impression. SSR can't read
  // localStorage, so the bar may flash before this effect hides it for a
  // visitor who already dismissed it — acceptable for an analytics surface.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(dismissKey);
      if (raw) {
        const until = Number(raw);
        if (!Number.isFinite(until) || until > Date.now()) {
          setOpen(false);
          return;
        }
      }
    } catch {
      /* private mode — fall through */
    }
    if (!impressionFired.current) {
      impressionFired.current = true;
      post(promotion.promotion_id, "events", {
        event_type: "impression",
        metadata: { surface: "announcement_bar" },
      });
    }
  }, [dismissKey, promotion.promotion_id]);

  if (!open) return null;

  const headline = pick(promotion, "headline", locale);
  const body = pick(promotion, "body", locale);
  const tx = promotion.translated_content as AnnouncementTranslations | undefined;
  const linkUrl = tx?.cta_url ?? content.link_url ?? null;
  const dismissible = content.dismissible ?? true;
  const bg = content.background || "#0f172a";
  const fg = content.text_color || "#ffffff";

  if (!headline && !body) return null;

  const onClose = () => {
    post(promotion.promotion_id, "events", {
      event_type: "dismiss",
      metadata: { surface: "announcement_bar" },
    });
    post(promotion.promotion_id, "dismiss", { remember_for_days: 30 });
    try {
      localStorage.setItem(dismissKey, String(Date.now() + 30 * 864e5));
    } catch {
      /* ignore */
    }
    setOpen(false);
  };

  const onClick = () =>
    post(promotion.promotion_id, "events", {
      event_type: "click",
      metadata: { surface: "announcement_bar" },
    });

  const inner = (
    <div className="flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium">
      {headline && <span>{headline}</span>}
      {body && <span className="opacity-90 hidden sm:inline">— {body}</span>}
    </div>
  );

  return (
    <div
      role="region"
      aria-label="Announcement"
      className="relative w-full border-b border-current/10"
      style={{ backgroundColor: bg, color: fg }}
    >
      <div className="relative mx-auto max-w-screen-xl">
        {linkUrl ? (
          <a
            href={linkUrl}
            onClick={onClick}
            className="block transition-opacity hover:opacity-90"
          >
            {inner}
          </a>
        ) : (
          inner
        )}
        {dismissible && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute end-2 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-black/10"
            style={{ color: fg }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
