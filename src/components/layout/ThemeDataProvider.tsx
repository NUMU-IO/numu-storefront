"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ThemeSettingsV3, StoreData } from "@/types";

interface ThemeDataContextValue {
  themeSettings: ThemeSettingsV3;
  storeData: StoreData;
  /**
   * Phase 2.4 — store navigation menus keyed by handle (`main-menu`,
   * `footer`, …), fetched once in `[domain]/layout.tsx` and read by
   * `ByotThemeBoundary` to inject into the bundle's mount context. Each
   * value is the raw bilingual item list; the SDK localizes it. Optional:
   * absent when the store has no menus or the fetch failed.
   */
  navigation?: Record<string, unknown[]>;
  /**
   * ENG-3 R1 — the request's resolved visitor locale (from the proxy's
   * `x-numu-locale` header: `/{locale}/…` prefix › `?locale=` › `numu_locale`
   * cookie › store default). Threaded here so `ByotThemeBoundary` can forward
   * it into every bundle mount ctx even though individual page routes don't
   * pass a `locale` prop. Without this an explicit `?locale=ar` flips the host
   * `<html dir>` but leaves the bundle on its default-language copy. Optional:
   * absent when no locale was resolved (bundle falls back to store default).
   */
  locale?: string;
}

const ThemeDataContext = createContext<ThemeDataContextValue | null>(null);

export function ThemeDataProvider({
  themeSettings,
  storeData,
  navigation,
  locale,
  children,
}: ThemeDataContextValue & { children: ReactNode }) {
  return (
    <ThemeDataContext.Provider
      value={{ themeSettings, storeData, navigation, locale }}
    >
      {children}
    </ThemeDataContext.Provider>
  );
}

export function useThemeData() {
  const ctx = useContext(ThemeDataContext);
  if (!ctx) throw new Error("useThemeData must be used within ThemeDataProvider");
  return ctx;
}

/**
 * Non-throwing variant — returns null outside the provider. Used by
 * `ByotThemeBoundary`, which can also render in contexts (theme forks,
 * isolated previews) that don't wrap it in `ThemeDataProvider`; there it
 * simply gets no injected navigation and the bundle falls back.
 */
export function useThemeDataOptional() {
  return useContext(ThemeDataContext);
}
