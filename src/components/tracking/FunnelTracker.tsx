"use client";

/**
 * Fire-once funnel-event trackers for the host's product / search / checkout /
 * thank-you routes. Rendering one of these next to the page body fires the
 * browser Pixel event + the CAPI POST (shared event_id) with no per-theme code.
 */

import { useEffect, useRef } from "react";
import { trackFunnel } from "@/lib/meta-pixel";
import { readCartFunnelData } from "@/lib/cart-funnel-data";

/** Mark a dedupe key as fired; returns false if it was already fired.
 *  Exported so imperative call sites (e.g. AddPaymentInfo on checkout
 *  submit) share the same sessionStorage-marker dedupe as the trackers. */
export function claim(dedupeKey?: string): boolean {
  if (!dedupeKey) return true;
  try {
    const k = `numu_evt_${dedupeKey}`;
    if (sessionStorage.getItem(k)) return false;
    sessionStorage.setItem(k, "1");
  } catch {
    /* private mode / quota — fall through and fire anyway */
  }
  return true;
}

/**
 * Fire a single funnel event once on mount.
 *
 * `dedupeKey` guards against double-fires across remounts / React Strict Mode
 * / back-navigation via a sessionStorage marker (e.g. one Purchase per order).
 */
export function FunnelTracker({
  step,
  data,
  eventId,
  dedupeKey,
}: {
  step: string;
  data?: Record<string, unknown>;
  eventId?: string;
  dedupeKey?: string;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    if (!claim(dedupeKey)) return;
    trackFunnel(step, data || {}, { eventId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

/**
 * Like <FunnelTracker> but enriches the event with cart value/contents fetched
 * from /api/cart first — used for InitiateCheckout, where the host route has
 * no cart data server-side. Cart money is integer cents → converted to MAJOR
 * units for Meta. Fires with whatever it has even if the cart fetch fails.
 */
export function CartFunnelTracker({
  step,
  currency,
  dedupeKey,
}: {
  step: string;
  currency?: string;
  dedupeKey?: string;
}) {
  const fired = useRef(false);
  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    if (!claim(dedupeKey)) return;
    (async () => {
      trackFunnel(step, await readCartFunnelData(currency));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
