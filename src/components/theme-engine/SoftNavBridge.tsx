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

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";

// Keep in sync with NAVIGATE_EVENT in @numueg/theme-sdk (components/Link).
// Hardcoded, not imported: the storefront must not bundle its own SDK copy —
// the theme executes the SDK from the host runtime import map.
const NAVIGATE_EVENT = "numu:navigate";

export function SoftNavBridge() {
  const router = useRouter();
  const params = useParams();
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
      router.push(inPathMode ? `/${domain}${href}` : href);
    };

    window.addEventListener(NAVIGATE_EVENT, onNavigate);
    return () => window.removeEventListener(NAVIGATE_EVENT, onNavigate);
  }, [router, domain]);

  return null;
}
