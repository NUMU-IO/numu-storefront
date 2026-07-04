"use client";

/**
 * Global abandoned-checkout emitter.
 *
 * Listens for `numu:cart:updated` — broadcast by the SDK's NuMuProvider on
 * every BYOT cart change AND by the built-in cart — and (debounced) upserts
 * the current cart into the backend's abandoned-checkout store. This is the
 * "on every cart change" half of the designed capture; the checkout contact
 * step adds the enriched (email/phone/address) half. Renders nothing.
 */

import { useEffect } from "react";
import { trackCartState } from "@/lib/abandoned-cart";

export function AbandonedCartTracker() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onCartChange = () => {
      if (timer) clearTimeout(timer);
      // Debounce: coalesce rapid quantity taps and the initial page-load
      // cart fetch into a single write.
      timer = setTimeout(() => {
        void trackCartState();
      }, 2500);
    };
    window.addEventListener("numu:cart:updated", onCartChange);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("numu:cart:updated", onCartChange);
    };
  }, []);

  return null;
}
