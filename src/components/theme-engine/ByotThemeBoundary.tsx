"use client";

import { useEffect, useState, type ReactNode } from "react";
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
  fallback?: ReactNode;
}

export default function ByotThemeBoundary({
  bundleUrl,
  cssUrl,
  bundleChecksum,
  themeSettings,
  storeData,
  products,
  collections,
  fallback,
}: ByotThemeBoundaryProps) {
  const [ThemeComponent, setThemeComponent] = useState<unknown>(null);
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
          setThemeComponent(() => mod);
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

  if (error || !ThemeComponent) {
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

  const Cmp = ThemeComponent as React.ComponentType<{
    themeSettings: ThemeSettingsV3;
    storeData: StoreData;
    products?: Product[];
    collections?: Collection[];
  }>;
  return (
    <Cmp
      themeSettings={themeSettings}
      storeData={storeData}
      products={products}
      collections={collections}
    />
  );
}
