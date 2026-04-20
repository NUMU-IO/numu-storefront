"use client";

import { useEffect, useState, type ReactNode } from "react";
import { loadExternalTheme, loadExternalCSS } from "@/lib/external-loader";
import type { ThemeSettingsV3, StoreData } from "@/types";

interface ByotThemeBoundaryProps {
  bundleUrl: string;
  cssUrl?: string | null;
  themeSettings: ThemeSettingsV3;
  storeData: StoreData;
  fallback?: ReactNode;
}

export default function ByotThemeBoundary({
  bundleUrl,
  cssUrl,
  themeSettings,
  storeData,
  fallback,
}: ByotThemeBoundaryProps) {
  const [ThemeComponent, setThemeComponent] = useState<any>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (cssUrl) loadExternalCSS(cssUrl);
        const mod = await loadExternalTheme(bundleUrl);
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
    return () => { cancelled = true; };
  }, [bundleUrl, cssUrl]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-gray-400">Loading theme...</div>
      </div>
    );
  }

  if (error || !ThemeComponent) {
    return fallback || (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-500">Failed to load theme. Using default.</div>
      </div>
    );
  }

  return <ThemeComponent themeSettings={themeSettings} storeData={storeData} />;
}
