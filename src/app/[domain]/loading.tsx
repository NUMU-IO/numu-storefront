"use client";
import { useEffect, useState } from "react";

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
  // transition feels continuous. Theme-tinted via the same CSS vars the
  // bundle uses, so it inherits the store's palette.
  const cards = Array.from({ length: 8 });
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className="min-h-screen bg-[var(--numu-paper)] [font-family:var(--numu-sans)] motion-safe:animate-pulse"
    >
      <span className="sr-only">Loading…</span>

      {/* Header bar: logo placeholder centered, icon placeholders right */}
      <div className="flex items-center justify-between border-b border-[var(--numu-navy)]/10 px-6 py-5">
        <div className="h-4 w-24 rounded bg-[var(--numu-navy)]/10" />
        <div className="mx-auto h-6 w-28 rounded bg-[var(--numu-navy)]/10" />
        <div className="flex gap-3">
          <div className="h-5 w-5 rounded-full bg-[var(--numu-navy)]/10" />
          <div className="h-5 w-5 rounded-full bg-[var(--numu-navy)]/10" />
          <div className="h-5 w-5 rounded-full bg-[var(--numu-navy)]/10" />
        </div>
      </div>

      {/* Page title + product grid placeholders */}
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 h-7 w-48 rounded bg-[var(--numu-navy)]/10" />
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {cards.map((_, i) => (
            <div key={i} className="flex flex-col gap-3">
              <div className="aspect-[4/5] w-full rounded bg-[var(--numu-navy)]/10" />
              <div className="h-3 w-3/4 rounded bg-[var(--numu-navy)]/10" />
              <div className="h-3 w-1/3 rounded bg-[var(--numu-navy)]/10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
