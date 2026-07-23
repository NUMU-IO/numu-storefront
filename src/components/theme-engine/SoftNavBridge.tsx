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

    // Prefetch on hover / touchstart. The SDK's <Link> renders a plain
    // <a> (not next/link), so nothing prefetches the RSC payload — every
    // soft nav paid the full server round-trip AFTER the click, which on
    // a cold PDP measured multiple seconds (page + ViewContent/PageView
    // events all delayed by it; fast bouncers produced no PDP events at
    // all). Warming the payload at intent time closes most of that gap.
    // Delegated + deduped; prefetch is a hint, so failures are ignored.
    const prefetched = new Set<string>();
    const onIntent = (e: Event) => {
      const target = e.target as Element | null;
      const a = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      if (a.target && a.target !== "_self") return;
      if (a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || !href.startsWith("/") || href.startsWith("//")) return;
      if (href.startsWith("/#")) return;
      const path = window.location.pathname;
      const inPathMode =
        path === `/${domain}` || path.startsWith(`/${domain}/`);
      const full = inPathMode ? `/${domain}${href}` : href;
      if (prefetched.has(full)) return;
      prefetched.add(full);
      try {
        router.prefetch(full);
      } catch {
        /* prefetch is best-effort */
      }
    };

    window.addEventListener(NAVIGATE_EVENT, onNavigate);
    document.addEventListener("pointerover", onIntent, { passive: true });
    document.addEventListener("touchstart", onIntent, { passive: true });
    return () => {
      window.removeEventListener(NAVIGATE_EVENT, onNavigate);
      document.removeEventListener("pointerover", onIntent);
      document.removeEventListener("touchstart", onIntent);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [router, domain]);

  // Route committed → the new page is on screen; drop the bar. For a
  // navigation WE claimed, also force the viewport to the top: the BYOT
  // page body mounts client-side AFTER commit, so at commit time the
  // document is short and the browser clamps the old scroll offset to
  // roughly the footer — the "page opens in the middle" bug. Router
  // scroll handling can't see the late-mounting content; an explicit
  // scroll can. Back/forward traversals never set `pending`, so their
  // native scroll restoration is untouched.
  useEffect(() => {
    if (pending) window.scrollTo({ top: 0, behavior: "instant" });
    setPending(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
