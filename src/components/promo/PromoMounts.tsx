"use client";

/**
 * Single mount point for the host-rendered promo overlays (popup, floating
 * widget, cookie banner) — rendered in [domain]/layout.tsx after the
 * announcement bar so the overlays sit above every page. Each surface picks
 * the highest-priority active promotion (server-sorted) and self-manages its
 * own trigger + dismissal.
 */

import type { ResolvedPromotion } from "@/lib/promo-server";
import { PopupModal } from "./PopupModal";
import { FloatingWidget } from "./FloatingWidget";
import { CookieBanner } from "./CookieBanner";

export function PromoMounts({
  popups,
  floatingWidgets,
  cookieBanner,
  locale = "ar",
}: {
  popups: ResolvedPromotion[];
  floatingWidgets: ResolvedPromotion[];
  cookieBanner: ResolvedPromotion | null;
  locale?: string;
}) {
  const popup = popups?.[0] ?? null;
  const widget = floatingWidgets?.[0] ?? null;
  return (
    <>
      {cookieBanner && <CookieBanner promotion={cookieBanner} locale={locale} />}
      {widget && (
        <FloatingWidget
          promotion={widget}
          popupCount={popups?.length || 0}
          locale={locale}
        />
      )}
      {popup && <PopupModal promotion={popup} locale={locale} />}
    </>
  );
}
