"use client";

/**
 * CustomerBridgeProvider — installs ``window.__numu_customer`` so the
 * theme SDK's ``useAnalytics().track()`` can include the authenticated
 * customer's ID on funnel-event POSTs.
 *
 * Mirrors the AttributionProvider pattern: the storefront knows the
 * customer from its own session (via GET /api/customer/me); BYOT
 * themes don't import from the host app, so we expose the value via
 * a window-level bridge that the SDK reads on every track call.
 *
 * Why this matters: without the bridge, every funnel-event row from
 * a BYOT theme lands with ``customer_id = NULL`` even for logged-in
 * shoppers. The customer-journey timeline only populates after the
 * next checkout backfill — and never if the shopper doesn't
 * re-checkout in the current session. See NUMU-api PR #325 + SDK
 * PR #13 for the matching server + SDK sides.
 *
 * Implementation notes:
 *   - One GET /api/customer/me on mount (anonymous sessions return
 *     401 → customer_id stays null, no bridge value set).
 *   - The bridge ``getId()`` closes over a ref so it always returns
 *     the latest value without us re-installing on every state
 *     change. Themes can call it synchronously from track().
 *   - We do NOT re-fetch on focus / route change. The SDK's
 *     NuMuProvider already hydrates customer state and a fresh page
 *     load runs this effect again. A logged-out → logged-in
 *     transition mid-session will see the OLD customer_id until the
 *     next page navigation — acceptable for analytics, not for auth.
 */

import { useEffect, useRef, type ReactNode } from "react";

interface CustomerMeResponse {
  id?: string;
}

declare global {
  interface Window {
    __numu_customer?: {
      getId(): string | null;
    };
  }
}

export function CustomerBridgeProvider({ children }: { children: ReactNode }) {
  // useRef so the bridge's getter always returns the freshest value
  // without forcing us to re-install the bridge each time state
  // changes. Sync read from the getter is intentional — track() can't
  // await.
  const customerIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.__numu_customer = {
      getId: () => customerIdRef.current,
    };

    let cancelled = false;
    (async () => {
      try {
        // Same-origin → cookie session ships automatically. 401 for
        // anonymous visitors is the expected branch — leave the ref
        // at null and the bridge keeps returning null until login.
        const res = await fetch("/api/customer/me", {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok || cancelled) return;
        const data: CustomerMeResponse = await res.json();
        if (cancelled) return;
        if (typeof data.id === "string" && data.id) {
          customerIdRef.current = data.id;
        }
      } catch {
        /* network / parse failure — leave ref null, themes treat
           visitor as anonymous for journey attribution */
      }
    })();

    return () => {
      cancelled = true;
      delete window.__numu_customer;
    };
  }, []);

  return <>{children}</>;
}
