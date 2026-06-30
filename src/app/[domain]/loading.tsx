"use client";
import { useEffect, useState } from "react";
import StorefrontSkeleton from "@/components/theme-engine/StorefrontSkeleton";

/**
 * Storefront loading state — Phase 5.7 WCAG-AA + Phase 7.3 static
 * BYOT template.
 *
 * BYOT contract: themes that declare `external_theme.loading_template_url`
 * in their `theme.json` get their static HTML/CSS injected here
 * INSTEAD of the platform's spinner+text. Same SSR-stamped data attr
 * mechanism as `error.tsx`.
 *
 * Accessibility (kept from Phase 5.7):
 *   - role="status" + aria-live="polite" announces loading without
 *     interrupting the screen reader's current task
 *   - Visible spinner uses 5.74:1 contrast (text-gray-600 on white)
 *   - motion-safe variant respects prefers-reduced-motion
 */
export default function StoreLoading() {
  const [themeHtml, setThemeHtml] = useState<string | null>(null);

  useEffect(() => {
    const url =
      typeof document !== "undefined"
        ? document.documentElement.dataset.numuLoadingTemplateUrl
        : undefined;
    if (!url) return;
    let cancelled = false;
    fetch(url, { cache: "force-cache" })
      .then((r) => (r.ok ? r.text() : null))
      .then((html) => {
        if (!cancelled && html) setThemeHtml(html);
      })
      .catch(() => {
        /* swallow — built-in fallback renders */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (themeHtml) {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Loading"
        dangerouslySetInnerHTML={{ __html: themeHtml }}
      />
    );
  }

  // Skeleton fallback. The previous lone centered spinner replaced the
  // whole page with empty space during navigation, which read as a blank
  // flash on every full-page nav (theme links are plain <a>). A header +
  // product-grid skeleton keeps the layout's shape on screen so the
  // transition feels continuous. Shared with ByotThemeBoundary's loading
  // state so the navigation wait and the bundle-mount wait look identical.
  return <StorefrontSkeleton />;
}
