/**
 * Server-side fetch of `/promotions/active` for the V3 storefront host.
 *
 * The backend promotions engine (offers-v2) resolves the visitor's active
 * promotions grouped by surface (announcement bar, popups, widgets, cookie
 * banner, auto-discounts). The V3 host renders the announcement bar in the
 * shell (see [domain]/layout.tsx) so it shows for built-in AND BYOT themes
 * with no per-theme code — the same model used for <MetaPixel>.
 *
 * Gated server-side by the `ff_storefront_promo_render` feature flag: when
 * off, the endpoint 404s and this returns null (no bar). ISR-tagged
 * `promotions:{storeId}` so a merchant publish busts it.
 */

import { cache } from "react";

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

export type PromotionSurface =
  | "discount_code"
  | "automatic"
  | "announcement_bar"
  | "popup"
  | "floating_widget"
  | "cookie_banner";

export interface ResolvedPromotion {
  promotion_id: string;
  surface: PromotionSurface;
  priority: number;
  content: Record<string, unknown>;
  translated_content: Record<string, unknown>;
  discount_rule: Record<string, unknown> | null;
  coupon_code: string | null;
  display: Record<string, unknown> | null;
  fingerprint: string;
}

export interface ActivePromotionsPayload {
  announcement_bars: ResolvedPromotion[];
  popups: ResolvedPromotion[];
  floating_widgets: ResolvedPromotion[];
  cookie_banner: ResolvedPromotion | null;
  auto_discounts: ResolvedPromotion[];
  discount_codes_visible: ResolvedPromotion[];
  resolved_at: string;
  cache_ttl_seconds: number;
}

interface FetchOpts {
  page?: string;
  device?: "desktop" | "mobile" | "tablet";
  locale?: "ar" | "en";
  previewToken?: string;
}

export const getActivePromotions = cache(
  async (
    storeId: string,
    opts: FetchOpts = {},
  ): Promise<ActivePromotionsPayload | null> => {
    const { page = "/", device = "desktop", locale = "ar", previewToken } = opts;
    const qs = new URLSearchParams({ page, device, locale });
    const url = `${API_URL}/storefront/store/${storeId}/promotions/active?${qs.toString()}`;

    const init: RequestInit & {
      next?: { revalidate: number; tags: string[] };
    } = {
      next: { revalidate: 300, tags: [`promotions:${storeId}`] },
    };
    if (previewToken) init.headers = { "X-Preview-Token": previewToken };

    try {
      // Bound SSR latency — a slow promo endpoint must not stall page render.
      // Promise.race (not AbortController) so we don't disturb Next's fetch
      // cache; on timeout the in-flight fetch may still warm the cache.
      const res = await Promise.race([
        fetch(url, init),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
      ]);
      if (!res || !res.ok) return null; // null = timeout, 404 = flag off
      const json = await res.json();
      return (json?.data ?? json ?? null) as ActivePromotionsPayload | null;
    } catch {
      return null;
    }
  },
);
