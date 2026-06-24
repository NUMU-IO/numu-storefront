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

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className="flex min-h-screen items-center justify-center bg-[var(--numu-paper)] px-4"
    >
      <div className="flex items-center gap-3 text-[var(--numu-navy)] motion-safe:animate-pulse [font-family:var(--numu-sans)]">
        <svg
          className="h-5 w-5"
          aria-hidden="true"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="3"
          />
          <path
            d="M22 12a10 10 0 0 1-10 10"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
        <span className="text-sm font-medium">Loading…</span>
      </div>
    </div>
  );
}
