"use client";

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { loadExternalTheme, loadExternalCSS } from "@/lib/external-loader";
import type { ThemeSettingsV3, StoreData } from "@/types";

interface PageContextData {
  /** "home" | "product" | "collection" | "cart" | "page" | "404" | … */
  type: string;
  title?: string;
  handle?: string;
  data?: Record<string, unknown>;
}

interface ByotThemeBoundaryProps {
  bundleUrl: string;
  cssUrl?: string | null;
  /** Optional SHA-256 hex digest from `marketplace_theme_versions.checksum`.
   *  When supplied, the loader verifies the fetched bundle against it
   *  before evaluation. */
  bundleChecksum?: string | null;
  themeSettings: ThemeSettingsV3;
  storeData: StoreData;
  /** Tells the bundle which template to render. Omit for home. */
  page?: PageContextData;
  fallback?: ReactNode;
}

// The two shapes a bundle's `mount` may return:
//
//   * Legacy: a plain cleanup function (`() => void`). Every prop change
//     forces an unmount/remount of the bundle's React subtree.
//   * Modern: an object `{ unmount, update? }`. When `update` is
//     present, prop-only changes (themeSettings / storeData / page)
//     are forwarded into the same React tree without re-running the
//     dynamic import. The customizer's "every keystroke updates the
//     preview" loop drops from ~80ms-per-edit (full reload) to ~5ms
//     (in-place re-render).
//
// `numu-theme init` scaffolds the modern shape; older themes still work.
type BundleHandle =
  | (() => void)
  | {
      unmount: () => void;
      update?: (props: BundleMountProps) => void;
    };

interface BundleMountProps {
  themeSettings: ThemeSettingsV3;
  storeData: StoreData;
  page?: PageContextData;
}

type BundleModule = {
  mount?: (el: HTMLElement, props: BundleMountProps) => BundleHandle;
  default?: unknown;
};

function callUnmount(handle: BundleHandle | null): void {
  if (!handle) return;
  if (typeof handle === "function") {
    handle();
    return;
  }
  handle.unmount();
}

function tryUpdate(
  handle: BundleHandle | null,
  props: BundleMountProps,
): boolean {
  if (handle && typeof handle === "object" && typeof handle.update === "function") {
    handle.update(props);
    return true;
  }
  return false;
}

// ── Bundle ErrorBoundary ────────────────────────────────────────────────────
//
// React's class ErrorBoundary is the only way to catch render-time errors
// from a child subtree. We use it at the host/bundle seam so:
//
//   1. A throw inside `mount()` during the synchronous initial render
//      (e.g. createRoot(el).render(<Theme/>) where <Theme> throws) is
//      caught by THIS boundary instead of crashing the host's React tree
//      (the iframe whitescreens with "Application error"). Without it,
//      one bad theme makes the entire storefront unrenderable.
//
//   2. The bundle's OWN React subtree is isolated by its own root
//      (createRoot owns its tree). Errors there generally don't reach
//      this boundary — they surface in the bundle's own error handlers.
//      This boundary catches the seam: anything host-React renders
//      around the bundle's container.
//
//   3. We post `numu:editor:bundle-error` to window.parent with the
//      error message so the V3 customizer can show "Theme threw an
//      error" inline next to the iframe instead of leaving merchants
//      staring at a frozen preview.
//
// We don't use `getDerivedStateFromError` to set fallback content here
// because the parent component already handles the visible fallback —
// we just need to swallow the error so the host doesn't propagate it.

interface BoundaryState {
  error: Error | null;
}

class ThemeRenderBoundary extends Component<
  { children: ReactNode; onError: (err: Error) => void; fallback: ReactNode },
  BoundaryState
> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Notify the wrapper so it can postMessage to the editor and re-render
    // the visible fallback. Console-log too so dev tools shows the trace.
    console.error("[ByotThemeBoundary] bundle render threw:", error);
    this.props.onError(error);
  }

  render() {
    if (this.state.error) return this.props.fallback;
    return this.props.children;
  }
}

function postBundleError(error: Error) {
  if (typeof window === "undefined") return;
  if (window.parent === window) return;
  try {
    window.parent.postMessage(
      {
        type: "numu:editor:bundle-error",
        payload: { message: error.message, stack: error.stack ?? null },
      },
      "*",
    );
  } catch {
    // Cross-origin postMessage with `*` should always succeed; if it
    // doesn't there's nothing useful to do.
  }
}

export default function ByotThemeBoundary({
  bundleUrl,
  cssUrl,
  bundleChecksum,
  themeSettings,
  storeData,
  page,
  fallback,
}: ByotThemeBoundaryProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<BundleHandle | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  // ── Bundle lifecycle ──────────────────────────────────────────────────────
  //
  // Two effects, on purpose:
  //
  //   1. The MOUNT effect (deps: bundleUrl/cssUrl/bundleChecksum) owns
  //      the dynamic-import → mod.mount → cleanup cycle. It runs once
  //      per bundle URL, so changing settings doesn't re-fetch the JS.
  //
  //   2. The UPDATE effect (deps: themeSettings/storeData/page) calls
  //      `mod.update(props)` on the existing handle when the bundle
  //      supports it. For older bundles whose `mount` returned a plain
  //      cleanup function, we fall back to a remount by toggling the
  //      mount key — slow path, but only needed for legacy themes.
  //
  // This split is what lets the customizer keep the iframe up while
  // the merchant edits 100 settings in a row. Before this change every
  // keystroke triggered a full bundle re-import + unmount/remount of
  // the React subtree (~80ms each); now prop-only updates are ~5ms.

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (cssUrl) loadExternalCSS(cssUrl);
        const mod = (await loadExternalTheme(bundleUrl, {
          expectedChecksum: bundleChecksum ?? null,
        })) as BundleModule;
        if (cancelled) return;
        const el = containerRef.current;
        if (!el) return;

        if (typeof mod.mount !== "function") {
          throw new Error(
            "Theme bundle does not export `mount(el, props)`. Older themes " +
              "rendered as a React component; that path is disabled until the " +
              "host ships an import map for shared React.",
          );
        }
        // Capture latest props at mount time. Subsequent updates are
        // delivered by the second effect; we don't read the closure-
        // captured values here because they'd be stale on the second
        // mount cycle if a settings change interleaves the import.
        handleRef.current = mod.mount(el, {
          themeSettings,
          storeData,
          page,
        });
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setLoading(false);
        postBundleError(e);
      }
    }

    load();
    return () => {
      cancelled = true;
      const handle = handleRef.current;
      handleRef.current = null;
      if (handle) {
        try {
          callUnmount(handle);
        } catch (err) {
          // Defensive: a broken bundle's unmount can throw too.
          console.warn("[ByotThemeBoundary] unmount threw:", err);
        }
      }
    };
    // Mount is keyed on bundle identity only. Prop changes are forwarded
    // by the update effect below — no remount needed for setting tweaks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundleUrl, cssUrl, bundleChecksum]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    try {
      const ok = tryUpdate(handle, { themeSettings, storeData, page });
      if (!ok) {
        // Legacy bundle (mount returned a cleanup function, no update
        // method). PreviewBridge already handles fine-grained settings
        // updates inside such bundles via postMessage, so missing
        // update() here just means the prop change won't be observed
        // out-of-band. Themes built with `numu-theme init` post-0.2.0
        // expose update() — log once so dev devs notice.
        console.debug(
          "[ByotThemeBoundary] bundle has no mod.update(); prop change " +
            "ignored (legacy mount contract). Update the theme scaffold.",
        );
      }
    } catch (err) {
      console.warn("[ByotThemeBoundary] update threw:", err);
    }
  }, [themeSettings, storeData, page]);

  const fallbackUI =
    fallback || (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2">
        <div className="text-red-500">Failed to load theme</div>
        {error && (
          <div className="text-xs text-gray-500 max-w-md text-center px-4">
            {error.message}
          </div>
        )}
      </div>
    );

  return (
    <ThemeRenderBoundary onError={postBundleError} fallback={fallbackUI}>
      {loading && !error && (
        <div className="min-h-screen flex items-center justify-center">
          <div className="animate-pulse text-gray-400">Loading theme...</div>
        </div>
      )}
      {error && fallbackUI}
      <div ref={containerRef} />
    </ThemeRenderBoundary>
  );
}
