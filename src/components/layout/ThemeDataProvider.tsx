"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { ThemeSettingsV3, StoreData } from "@/types";

interface ThemeDataContextValue {
  themeSettings: ThemeSettingsV3;
  storeData: StoreData;
}

const ThemeDataContext = createContext<ThemeDataContextValue | null>(null);

export function ThemeDataProvider({
  themeSettings,
  storeData,
  children,
}: ThemeDataContextValue & { children: ReactNode }) {
  return (
    <ThemeDataContext.Provider value={{ themeSettings, storeData }}>
      {children}
    </ThemeDataContext.Provider>
  );
}

export function useThemeData() {
  const ctx = useContext(ThemeDataContext);
  if (!ctx) throw new Error("useThemeData must be used within ThemeDataProvider");
  return ctx;
}
