"use client";

/**
 * First-party page-view tracker for the V3 storefront host.
 *
 * Mounted once, unconditionally, in [domain]/layout.tsx. On every route
 * (initial load + App-Router soft navigations) it POSTs a navigation step
 * to `/api/storefront/track`, which lands in the backend's `page_views` +
 * `funnel_events` tables — the data source for sessions, unique visitors,
 * bounce rate, landing pages, conversion rate, and Live View.
 *
 * Before this component existed, NOTHING emitted a generic page view:
 * `page_views` was populated almost exclusively by product-detail pages
 * (via <FunnelTracker step="product_view">), so every session-based metric
 * was structurally starved. This is the fix for that root cause.
 *
 * Route classification (one navigation row per view — never two):
 *   - `/products/<slug>`     → SKIPPED here. The PDP renders
 *     <FunnelTracker step="product_view">, which already POSTs the
 *     navigation row; firing page_view too would double-count the view.
 *   - `/collections/<slug>`  → `collection_view` (navigation step, with
 *     the slug in step_data so per-collection analytics can be built).
 *   - everything else        → `page_view`. This includes search, cart,
 *     checkout, and thank-you pages: their <FunnelTracker> steps (search,
 *     checkout_started, order_completed, …) are non-navigation funnel
 *     events server-side and do NOT write page_views rows.
 *
 * First-party only: no browser pixel fires from here. <MetaPixel> owns the
 * Meta PageView (initial snippet + its own route-change effect).
 *
 * Path shape: in production the store is subdomain-hosted and pathname is
 * `/products/x`; in dev path-segment mode it's `/<subdomain>/products/x`.
 * Classification therefore checks the first TWO segments for the
 * products/collections markers.
 */

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { trackFirstPartyNavigation } from "@/lib/meta-pixel";

type NavStep =
  | { step: "page_view" | "collection_view"; data?: Record<string, unknown> }
  | null;

/** Exported for unit tests. */
export function classifyNavigation(pathname: string): NavStep {
  const segs = (pathname || "/").split("/").filter(Boolean);
  // The routable segment may sit at index 0 (subdomain hosting) or index 1
  // (dev path-segment mode, where segs[0] is the store subdomain).
  for (let i = 0; i < Math.min(segs.length, 2); i++) {
    // Product detail page — <FunnelTracker step="product_view"> on the
    // PDP already records this navigation. BOTH spellings are live:
    // the host route is /products/<slug> (plural), but V3 themes link
    // /product/<slug> (singular, the V2-era convention) which the
    // no-404 catch-all serves with the same PDP — verified in QA that
    // missing the singular form double-counted every themed PDP view.
    if ((segs[i] === "products" || segs[i] === "product") && segs[i + 1]) {
      return null;
    }
    if (segs[i] === "collections" && segs[i + 1]) {
      return {
        step: "collection_view",
        data: { collection_slug: decodeURIComponent(segs[i + 1]) },
      };
    }
  }
  return { step: "page_view" };
}

export function PageViewTracker() {
  const pathname = usePathname();
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || lastTracked.current === pathname) return;
    lastTracked.current = pathname;
    const nav = classifyNavigation(pathname);
    if (!nav) return;
    trackFirstPartyNavigation(nav.step, nav.data);
  }, [pathname]);

  return null;
}
