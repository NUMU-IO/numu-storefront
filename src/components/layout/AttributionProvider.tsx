"use client";

/**
 * AttributionProvider — page-load capture of the numu_attribution cookie.
 *
 * Mounts alongside ThemeDataProvider in app/[domain]/layout.tsx. On
 * first mount (one-shot useEffect):
 *
 *   1. Reads window.location.search + document.referrer + pathname
 *   2. Calls captureAndPersist (merges with existing cookie per R-01:
 *      first_touch immutable, last_touch overwritten, session_id stable)
 *   3. Installs a window-scoped bridge at `window.__numu_attribution` so
 *      BYOT theme bundles can read the envelope without importing from
 *      the host app:
 *
 *        const env = (window as any).__numu_attribution?.get?.()
 *
 *      Themes spread `env` into their checkout body alongside the flat
 *      utm_* fields they may already collect — backend prefers the
 *      envelope when both are present.
 *
 * For built-in (non-BYOT) themes living inside this repo, prefer
 * `useAttribution()` (importable directly) over the window bridge.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  captureAndPersist,
  readCookie,
} from "@/lib/attribution-client";
import type { AttributionSnapshot } from "@/lib/attribution-types";

const AttributionContext = createContext<AttributionSnapshot | null>(null);

declare global {
  interface Window {
    __numu_attribution?: {
      get(): AttributionSnapshot | null;
    };
  }
}

export function AttributionProvider({ children }: { children: ReactNode }) {
  const [envelope, setEnvelope] = useState<AttributionSnapshot | null>(() => {
    if (typeof document === "undefined") return null;
    return readCookie();
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const next = captureAndPersist({
      search: window.location.search,
      referrer: document.referrer,
      landingPath: window.location.pathname,
    });
    if (next) setEnvelope(next);

    // BYOT bridge — read-only access to the current envelope. Themes
    // bundle their own React tree, so they can't import the context
    // directly. The bridge always reads fresh from the cookie so the
    // theme sees the same data the host app sees, even if the host
    // hasn't re-rendered.
    window.__numu_attribution = {
      get: () => readCookie(),
    };

    return () => {
      delete window.__numu_attribution;
    };
  }, []);

  return (
    <AttributionContext.Provider value={envelope}>
      {children}
    </AttributionContext.Provider>
  );
}

/** Read the current envelope. Returns null in SSR or before the first
 *  cookie read. Callers should treat null as "no attribution to send"
 *  and skip the field rather than POSTing an empty object. */
export function useAttribution(): AttributionSnapshot | null {
  return useContext(AttributionContext);
}
