"use client";

/**
 * SoftNavBridge — turns the SDK's `numu:navigate` CustomEvent into a
 * Next.js client-side route change on the PUBLIC storefront.
 *
 * The other half of the SDK 0.10 soft-navigation contract: the SDK's
 * <Link> dispatches a CANCELABLE `numu:navigate` on window for eligible
 * plain left-clicks. We claim it with `event.preventDefault()` and
 * `router.push` the target — React, the SDK runtime, and the evaluated
 * theme bundle all stay warm, so page-to-page moves skip the full
 * document reload + theme remount that made every navigation flash a
 * loading state. When this bridge isn't mounted (or the runtime SDK
 * predates 0.10), the Link falls back to default anchor behavior — a
 * normal full-page navigation — so nothing ever breaks.
 *
 * Transition feedback: there is deliberately NO route-level loading.tsx
 * under [domain] — with one, App Router replaces the ENTIRE old page
 * with the skeleton on every client navigation, which reads exactly
 * like the full reload soft nav exists to kill. Instead the previous
 * page stays visible while the next page's RSC payload loads, and this
 * bridge renders a slim top progress bar so the click still has
 * immediate feedback (the SPA convention: YouTube/GitHub-style).
 *
 * Path handling: themes always write root paths (`/products/foo`). In
 * production the store is served on its subdomain, so the browser path
 * IS the root path — push as-is (proxy.ts rewrites the RSC fetch to
 * `/<subdomain>/...` server-side, same as a hard navigation). In dev
 * path-segment routing the browser path carries the `/<domain>` prefix,
 * so we re-prefix the pushed href or the navigation would escape the
 * store. Distinguished at click time from `location.pathname` — the
 * only reliable signal for which addressing mode the document is on.
 *
 * Distinct from PreviewNavigationBridge, which serves the editor's
 * postMessage protocol inside the preview iframe (always path-segment,
 * preview-gated). This one is for real shoppers.
 */

import { useEffect, useRef, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";

// Keep in sync with NAVIGATE_EVENT in @numueg/theme-sdk (components/Link).
// Hardcoded, not imported: the storefront must not bundle its own SDK copy —
// the theme executes the SDK from the host runtime import map.
const NAVIGATE_EVENT = "numu:navigate";

// Safety valve: clear the pending bar even if the route never changes
// (push to the same pathname, or a navigation error swallowed upstream).
const PENDING_TIMEOUT_MS = 8_000;

export function SoftNavBridge() {
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const domain = typeof params?.domain === "string" ? params.domain : null;

  useEffect(() => {
    if (!domain) return;

    const onNavigate = (e: Event) => {
      const href = (e as CustomEvent<{ href?: unknown }>).detail?.href;
      if (typeof href !== "string" || !href.startsWith("/")) return;
      // Path-segment mode (dev / direct-IP access): the live URL starts
      // with `/<domain>` → keep the prefix on the pushed path. Subdomain
      // mode (production): push the root path unchanged.
      const path = window.location.pathname;
      const inPathMode =
        path === `/${domain}` || path.startsWith(`/${domain}/`);
      e.preventDefault(); // claim it — the Link suppresses the full nav
      setPending(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(
        () => setPending(false),
        PENDING_TIMEOUT_MS,
      );
      router.push(inPathMode ? `/${domain}${href}` : href);
    };

    window.addEventListener(NAVIGATE_EVENT, onNavigate);
    return () => {
      window.removeEventListener(NAVIGATE_EVENT, onNavigate);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [router, domain]);

  // Route committed → the new page is on screen; drop the bar.
  useEffect(() => {
    setPending(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, [pathname]);

  if (!pending) return null;

  // Slim indeterminate top bar. Inline styles + a scoped keyframe so it
  // needs no global CSS and can't collide with theme styles. Uses the
  // theme's accent when the store defines one (--theme-primary is set by
  // the standard color settings), falling back to a neutral dark.
  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      style={{
        position: "fixed",
        top: 0,
        insetInlineStart: 0,
        width: "100%",
        height: 3,
        zIndex: 2147483000,
        pointerEvents: "none",
        background: "transparent",
      }}
    >
      <style>{`
        @keyframes numu-nav-progress {
          0% { transform: translateX(-100%); }
          49% { transform: translateX(60%); }
          100% { transform: translateX(120%); }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-numu-nav-bar] { animation: none !important; transform: none !important; opacity: .6; }
        }
      `}</style>
      <div
        data-numu-nav-bar
        style={{
          height: "100%",
          width: "40%",
          background: "var(--theme-primary, #1f2937)",
          animation: "numu-nav-progress 1.2s ease-in-out infinite",
        }}
      />
    </div>
  );
}
