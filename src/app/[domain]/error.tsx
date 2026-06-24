"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Storefront error boundary — Phase 5.7 WCAG-AA + Phase 7.3 static
 * BYOT template.
 *
 * BYOT contract: themes that declare `external_theme.error_template_url`
 * in their `theme.json` get their static HTML/CSS injected here
 * INSTEAD of the platform's hardcoded fallback. The URL is resolved
 * by the root layout (SSR) and stamped on `<html data-numu-error-
 * template-url>`. We read it via `document.documentElement.dataset`
 * because at error-time the React tree might be in an unknown state
 * and a vanilla DOM read is the most reliable surface.
 *
 * Fetch failures, missing URLs, or 404s all fall back to the platform
 * chrome — themes can never make the error page itself error out.
 *
 * Accessibility (kept from Phase 5.7):
 *   - role="alert" announces the failure assertively
 *   - "Try again" button is the first focusable element
 *   - red-700 on white = 5.94:1 contrast (exceeds AA 4.5:1)
 */
export default function StoreError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  const [themeHtml, setThemeHtml] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const url =
      typeof document !== "undefined"
        ? document.documentElement.dataset.numuErrorTemplateUrl
        : undefined;
    if (!url) return;
    // Theme templates are static — light caching is safe and keeps
    // the error path off the network during repeated retries.
    fetch(url, { cache: "force-cache" })
      .then((r) => (r.ok ? r.text() : null))
      .then((html) => {
        if (mountedRef.current && html) setThemeHtml(html);
      })
      .catch(() => {
        /* swallow — built-in fallback renders */
      });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // After injecting the theme HTML, wire any [data-numu-reset] button
  // inside the template so themes don't have to ship JS. Themes can
  // also use `<button onclick="window.location.reload()">` as a
  // simpler escape hatch.
  useEffect(() => {
    if (!themeHtml) return;
    const handler = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest("[data-numu-reset]")) {
        e.preventDefault();
        reset();
      }
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [themeHtml, reset]);

  if (themeHtml) {
    return (
      <div
        role="alert"
        // The theme HTML is static + author-controlled at build time
        // (it's in the theme's repo). We don't accept user-controlled
        // input here, so dangerouslySetInnerHTML is acceptable. A
        // future hardening pass could DOMPurify-sanitize it.
        dangerouslySetInnerHTML={{ __html: themeHtml }}
      />
    );
  }

  return (
    <main
      role="alert"
      aria-labelledby="error-title"
      className="flex min-h-screen items-center justify-center bg-[var(--numu-paper)] px-4 [font-family:var(--numu-sans)]"
    >
      <div className="w-full max-w-md rounded-[var(--numu-radius)] border border-[var(--numu-border)] bg-[var(--numu-surface)] p-8 text-center shadow-[0_22px_50px_-24px_rgba(12,45,84,0.32)] sm:p-10">
        <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[#c14a1c]">
          Error
        </p>
        <h1
          id="error-title"
          className="text-2xl font-bold text-[var(--numu-ink)] [font-family:var(--numu-display)]"
        >
          Something went wrong
        </h1>
        {error.message && (
          <p className="mt-3 text-sm text-[var(--numu-ink-soft)]">
            {error.message}
          </p>
        )}
        <button
          type="button"
          onClick={reset}
          autoFocus
          className="numu-btn-navy mt-7 inline-flex min-h-11 items-center justify-center rounded-full px-7 py-2.5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--numu-navy)]"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
