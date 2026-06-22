"use client";

/**
 * PreviewNavigationBridge — turns the editor's `numu:theme:navigate`
 * postMessage into a Next.js client-side route change INSIDE the preview
 * iframe, instead of the dashboard reloading the iframe `src`.
 *
 * Why: previously every page switch in the V3 editor changed the iframe
 * `src`, which forced a full document reload of the storefront (re-download
 * HTML/RSC, re-hydrate, re-mount the theme bundle) — a multi-hundred-ms
 * "Loading preview…" flash on every switch. A soft `router.push` keeps the
 * Next runtime, the `[domain]` layout (and `PreviewBridge`), and the cached
 * theme bundle warm; only the changed route segment re-renders.
 *
 * The companion `PreviewBridge`:
 *   - validates the editor origin and re-emits navigate as a
 *     `numu:theme-navigate` window CustomEvent (with `{ page, path }`),
 *   - re-announces `numu:editor:ready` after the navigation so the hub
 *     re-pushes the live draft to the freshly-mounted page.
 *
 * Inert on the public storefront: only arms when `?preview=true&editor=v3`
 * AND we're inside an iframe (same gate as PreviewBridge).
 */

import { useEffect } from "react";
import {
  useParams,
  usePathname,
  useRouter,
  useSearchParams,
} from "next/navigation";

// Pages worth prefetching once the editor preview is up, so the FIRST switch
// to each is already warm. Mirrors the editor's page list (minus resource
// pages, which need a picked slug the host appends at navigate time).
const PREFETCH_SUBPATHS = ["", "products", "collections", "cart", "search"];

export function PreviewNavigationBridge() {
  const router = useRouter();
  const params = useParams();
  const search = useSearchParams();
  const pathname = usePathname();

  const isPreview = search.get("preview") === "true";
  const editorParam = search.get("editor");
  const domain = typeof params?.domain === "string" ? params.domain : null;

  useEffect(() => {
    if (!isPreview || editorParam !== "v3" || !domain) return;
    if (typeof window === "undefined" || window.parent === window) return;

    // Preserve the preview query string (preview/editor/store_id) across the
    // navigation — without it the new route drops out of preview mode and the
    // bridge/inspector would go inert.
    const query = search.toString();
    const suffix = query ? `?${query}` : "";

    const targetFor = (subpath: string): string => {
      const clean = (subpath || "").replace(/^\/+/, "");
      const base = clean ? `/${domain}/${clean}` : `/${domain}`;
      return `${base}${suffix}`;
    };

    // Warm the common pages so the first switch to each is instant.
    for (const sp of PREFETCH_SUBPATHS) {
      try {
        router.prefetch(targetFor(sp));
      } catch {
        /* prefetch is best-effort */
      }
    }

    function onNavigate(e: Event) {
      const detail = (e as CustomEvent).detail as
        | { page?: string; path?: string }
        | undefined;
      if (!detail) return;
      // Prefer the precomputed subpath from the host; fall back to the page id.
      const subpath =
        typeof detail.path === "string" ? detail.path : detail.page ?? "";
      const target = targetFor(subpath);
      // Compare against the current pathname (ignoring query) so we don't
      // re-push the route we're already on — that would loop with the
      // re-announced ready → navigate handshake.
      const targetPath = target.split("?")[0];
      if (targetPath === pathname) return;
      try {
        router.push(target);
      } catch {
        // Hard fallback: if soft navigation throws, do a location change so
        // the merchant still sees the page (slower, but never stuck).
        try {
          window.location.assign(target);
        } catch {
          /* give up silently */
        }
      }
    }

    window.addEventListener("numu:theme-navigate", onNavigate as EventListener);
    return () =>
      window.removeEventListener(
        "numu:theme-navigate",
        onNavigate as EventListener,
      );
  }, [isPreview, editorParam, domain, pathname, router, search]);

  return null;
}
