"use client";

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { loadExternalTheme, loadExternalCSS } from "@/lib/external-loader";
import { useThemeDataOptional } from "@/components/layout/ThemeDataProvider";
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
  /**
   * Phase 3.6 — visitor-chosen locale (from `?locale=ar` querystring or
   * the `numu_locale` cookie, resolved by the storefront proxy and
   * forwarded via the `x-numu-locale` header). When omitted, the bundle's
   * NuMuProvider falls back to `store.default_language`.
   */
  locale?: string;
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
      // Modern contract (scaffolded by `numu-theme init`).
      unmount?: () => void;
      update?: (props: BundleMountProps) => void;
      // Legacy / SDK MountResult contract (bon-younes et al.): `cleanup`
      // instead of `unmount`, `applyDraft(themeSettings)` instead of
      // `update(props)`. The host accepts both so unmount + live-preview
      // edits work regardless of which contract a bundle shipped with.
      cleanup?: () => void;
      applyDraft?: (themeSettings: ThemeSettingsV3) => void;
    };

interface BundleMountProps {
  themeSettings: ThemeSettingsV3;
  storeData: StoreData;
  page?: PageContextData;
  /** Visitor's active locale (Phase 3.6). Bundles forward this into
   *  NuMuProvider as `initialLocale`. Older bundles that don't read it
   *  fall through to `store.default_language` as before. */
  locale?: string;
  /** AUTHORITATIVE marketplace-preview flag — true ONLY for the catalog
   *  "Try theme" preview, false for editor/installed/public (see computeDemo).
   *  Bundles read it as `ctx.demo`. */
  demo?: boolean;
  /** Phase 2.4 — store navigation menus keyed by handle, resolved
   *  server-side and forwarded so the bundle's NuMuProvider populates
   *  `useNavigation(handle)` without a client round-trip. */
  navigation?: Record<string, unknown[]>;
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
  // Modern bundles expose `unmount`; legacy/SDK MountResult exposes `cleanup`.
  if (typeof handle.unmount === "function") handle.unmount();
  else if (typeof handle.cleanup === "function") handle.cleanup();
}

/**
 * AUTHORITATIVE marketplace-preview signal, passed to every V3 bundle as
 * `ctx.demo`. The hub opens the catalog "Try theme" preview iframe at the
 * storefront with `?preview_theme_slug=<slug>` (proxy.ts forwards it as a
 * header AND, being an internal rewrite, keeps it in the client URL). The
 * editor preview (`?preview=true&editor=v3`), installed/activated stores, and
 * public SSR NEVER carry `preview_theme_slug` → demo=false.
 *
 * This replaces the bundle's own fragile empty-templates inference as the
 * demo trigger: a real installed store whose stored customization diverges
 * from the active bundle's schemas can have its `templates` emptied by the
 * storefront sanitiser, which would otherwise flip the bundle into demo mode
 * and render demo (coffee) imagery on a live merchant store. Keying demo on
 * the preview marker — never on store data — makes that impossible by design.
 * Bundles built with `typeof ctx.demo === "boolean" ? ctx.demo : …` honour
 * this; older bundles fall back to their own inference (harmless).
 */
function computeDemo(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(
      new URLSearchParams(window.location.search).get("preview_theme_slug"),
    );
  } catch {
    return false;
  }
}

function tryUpdate(
  handle: BundleHandle | null,
  props: BundleMountProps,
): boolean {
  if (!handle || typeof handle !== "object") return false;
  // Modern contract: update(props). Legacy/SDK MountResult: applyDraft(settings).
  if (typeof handle.update === "function") {
    handle.update(props);
    return true;
  }
  if (typeof handle.applyDraft === "function") {
    handle.applyDraft(props.themeSettings);
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
  locale,
  fallback,
}: ByotThemeBoundaryProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<BundleHandle | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  // Phase 2.4 — store nav menus injected once by the layout. Stable per
  // session; read here (non-throwing) and forwarded into every mount ctx.
  const navigation = useThemeDataOptional()?.navigation;

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
          locale,
          demo: computeDemo(),
          navigation,
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
      const ok = tryUpdate(handle, {
        themeSettings,
        storeData,
        page,
        locale,
        demo: computeDemo(),
        navigation,
      });
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
  }, [themeSettings, storeData, page, locale, navigation]);

  // Live-preview edits (editor only). The dashboard's LivePreview posts
  // `numu:theme:update` on every change; PreviewBridge re-dispatches it as a
  // `numu:theme-update` window event. The `themeSettings` PROP is server-
  // rendered and never changes on the client, so the update effect above
  // can't carry live edits — apply them straight to the bundle handle here via
  // update()/applyDraft(). Inert on the public storefront: nothing fires
  // `numu:theme-update` outside the editor iframe.
  useEffect(() => {
    // Editor iframe only — never wire this on the public storefront (a real
    // shopper's page is top-level). PreviewBridge (the sole emitter of
    // numu:theme-update) is already editor-gated; this is defense-in-depth so
    // the listener isn't even registered for shoppers.
    if (typeof window === "undefined" || window.parent === window) return;
    function onThemeUpdate(e: Event) {
      const next = (e as CustomEvent).detail as ThemeSettingsV3 | undefined;
      if (!next) return;
      try {
        tryUpdate(handleRef.current, {
          themeSettings: next,
          storeData,
          page,
          locale,
          demo: computeDemo(),
          navigation,
        });
      } catch (err) {
        console.warn("[ByotThemeBoundary] live update threw:", err);
      }
    }
    window.addEventListener("numu:theme-update", onThemeUpdate as EventListener);
    return () =>
      window.removeEventListener(
        "numu:theme-update",
        onThemeUpdate as EventListener,
      );
  }, [storeData, page, locale, navigation]);

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
