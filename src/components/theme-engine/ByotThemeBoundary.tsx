"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { loadExternalTheme, loadExternalCSS } from "@/lib/external-loader";
import type { ThemeSettingsV3, StoreData, Product, Collection } from "@/types";

interface ByotThemeBoundaryProps {
  bundleUrl: string;
  cssUrl?: string | null;
  /** Optional SHA-256 hex digest from `marketplace_theme_versions.checksum`.
   *  When supplied, the loader verifies the fetched bundle against it
   *  before evaluation. */
  bundleChecksum?: string | null;
  themeSettings: ThemeSettingsV3;
  storeData: StoreData;
  /** Pre-fetched catalog the host loaded server-side. Forwarded to the
   *  bundle so theme sections that call useProducts() / useCollections()
   *  see real data without each section round-tripping the API. */
  products?: Product[];
  collections?: Collection[];
  /** Wave 5 — id of the active page template ("home" | "product" |
   *  "collection" | "cart" | "checkout" | "order-confirmation" |
   *  "profile" | "page" | "404"). Hosts pass this from the route so
   *  the bundle's useCurrentTemplate() returns the right value
   *  without scraping window.location. Defaults to "home". */
  currentTemplate?: string;
  /** Wave 5 — active product for the product template. Optional; only
   *  populated on /products/[slug]. */
  currentProduct?: unknown;
  /** Wave 5 — active collection for the collection template. */
  currentCollection?: unknown;
  fallback?: ReactNode;
}

/**
 * Loose shape every V3 imperative bundle returns from `mount()`.
 * Legacy (pre-Wave 3) bundles return just a cleanup fn; Wave 3+
 * return `{ cleanup, applyDraft }` so themeSettings changes flow
 * through `applyDraft(next)` without an unmount/remount churn.
 */
type MountReturn =
  | (() => void)
  | { cleanup: () => void; applyDraft?: (next: unknown) => void };

interface Wave3Handle {
  cleanup: () => void;
  applyDraft?: (next: unknown) => void;
}

function isWave3Handle(v: unknown): v is Wave3Handle {
  return (
    !!v &&
    typeof v === "object" &&
    "cleanup" in (v as object) &&
    typeof (v as { cleanup?: unknown }).cleanup === "function"
  );
}

/**
 * V3 bundles come in two flavours and we have to support both:
 *
 *   1. **Declarative** — `default export = React component`. The host
 *      renders `<Cmp themeSettings={...} ... />`. Simpler bundles
 *      (no shared React identity required) use this.
 *
 *   2. **Imperative** — `default export = { kind: "v3-mount", mount,
 *      manifest, … }` (a "v3Handle"). The host calls `mount(el, ctx)`
 *      and receives a `MountResult`. The bundle owns its own React
 *      tree inside `el` (often via createRoot + StrictMode + its own
 *      provider). Required for federated bundles that need to share
 *      React identity with the host across the seam.
 *
 * `loadExternalTheme` returns `mod.default ?? mod`. We sniff the shape
 * and dispatch — without this branch, an imperative bundle would crash
 * the first render because React tries to render a plain object as a
 * component.
 */
function isV3MountHandle(
  mod: unknown,
): mod is {
  kind?: string;
  mount: (el: HTMLElement, ctx: Record<string, unknown>) => MountReturn | Promise<MountReturn>;
} {
  if (!mod || typeof mod !== "object") return false;
  const m = mod as { kind?: unknown; mount?: unknown };
  return typeof m.mount === "function";
}

/**
 * Imperative wrapper — mounts a v3Handle bundle into a host `<div>`
 * and keeps it in sync via applyDraft on themeSettings change.
 */
function ImperativeBundleHost({
  handle,
  themeSettings,
  storeData,
  products,
  collections,
  currentTemplate,
  currentProduct,
  currentCollection,
}: {
  handle: {
    mount: (el: HTMLElement, ctx: Record<string, unknown>) => MountReturn | Promise<MountReturn>;
  };
  themeSettings: ThemeSettingsV3;
  storeData: StoreData;
  products?: Product[];
  collections?: Collection[];
  currentTemplate: string;
  currentProduct: unknown;
  currentCollection: unknown;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const applyDraftRef = useRef<((next: unknown) => void) | null>(null);

  // Re-mount only when the bundle handle or the identity (store, route,
  // resource) changes — NOT when themeSettings changes. The latter is
  // routed through applyDraft below for in-place reconciliation.
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    let alive = true;

    const ctx = {
      store: storeData,
      themeSettings,
      products,
      collections,
      currentTemplate,
      currentProduct,
      currentCollection,
      locale: storeData?.default_language,
    };

    Promise.resolve(handle.mount(el, ctx))
      .then((result) => {
        if (!alive) {
          // Unmounted before mount() resolved — clean up immediately
          if (typeof result === "function") {
            try { result(); } catch { /* swallow */ }
          } else if (isWave3Handle(result)) {
            try { result.cleanup(); } catch { /* swallow */ }
          }
          return;
        }
        if (typeof result === "function") {
          cleanupRef.current = result;
          applyDraftRef.current = null;
        } else if (isWave3Handle(result)) {
          cleanupRef.current = result.cleanup;
          applyDraftRef.current = result.applyDraft ?? null;
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[ByotThemeBoundary] bundle mount threw:", err);
      });

    return () => {
      alive = false;
      const fn = cleanupRef.current;
      cleanupRef.current = null;
      applyDraftRef.current = null;
      if (fn) {
        try { fn(); } catch (err) {
          // eslint-disable-next-line no-console
          console.error("[ByotThemeBoundary] cleanup threw:", err);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    handle,
    storeData,
    currentTemplate,
    currentProduct,
    currentCollection,
    // products/collections changes shouldn't remount — pass them through
    // mount once and let the bundle re-fetch on its own if it cares.
  ]);

  // Live preview path — push themeSettings updates through applyDraft.
  // No-op for legacy bundles (no applyDraft); they re-mount via the
  // effect above if the host bumps a key on themeSettings change.
  useEffect(() => {
    const apply = applyDraftRef.current;
    if (apply) {
      try {
        apply(themeSettings);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[ByotThemeBoundary] applyDraft threw:", err);
      }
    }
  }, [themeSettings]);

  return <div ref={hostRef} data-byot-host />;
}

export default function ByotThemeBoundary({
  bundleUrl,
  cssUrl,
  bundleChecksum,
  themeSettings,
  storeData,
  products,
  collections,
  currentTemplate = "home",
  currentProduct,
  currentCollection,
  fallback,
}: ByotThemeBoundaryProps) {
  const [themeModule, setThemeModule] = useState<unknown>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (cssUrl) loadExternalCSS(cssUrl);
        const mod = await loadExternalTheme(bundleUrl, {
          expectedChecksum: bundleChecksum ?? null,
        });
        if (!cancelled) {
          setThemeModule(() => mod);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [bundleUrl, cssUrl, bundleChecksum]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading theme...</div>
      </div>
    );
  }

  if (error || !themeModule) {
    return (
      fallback || (
        <div className="min-h-screen flex flex-col items-center justify-center gap-2">
          <div className="text-red-500">Failed to load theme</div>
          {error && (
            <div className="text-xs text-gray-500 max-w-md text-center px-4">
              {error.message}
            </div>
          )}
        </div>
      )
    );
  }

  // Imperative bundle — sniff the shape and dispatch to the wrapper.
  if (isV3MountHandle(themeModule)) {
    return (
      <ImperativeBundleHost
        handle={themeModule}
        themeSettings={themeSettings}
        storeData={storeData}
        products={products}
        collections={collections}
        currentTemplate={currentTemplate}
        currentProduct={currentProduct}
        currentCollection={currentCollection}
      />
    );
  }

  // Declarative bundle — render as a React component.
  const Cmp = themeModule as React.ComponentType<{
    themeSettings: ThemeSettingsV3;
    storeData: StoreData;
    products?: Product[];
    collections?: Collection[];
    currentTemplate?: string;
    currentProduct?: unknown;
    currentCollection?: unknown;
  }>;
  return (
    <Cmp
      themeSettings={themeSettings}
      storeData={storeData}
      products={products}
      collections={collections}
      currentTemplate={currentTemplate}
      currentProduct={currentProduct}
      currentCollection={currentCollection}
    />
  );
}
