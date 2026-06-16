"use client";

/**
 * Fire-once funnel-event trackers for the host's product / search / checkout /
 * thank-you routes. Rendering one of these next to the page body fires the
 * browser Pixel event + the CAPI POST (shared event_id) with no per-theme code.
 */

import { useEffect, useRef } from "react";
import { trackFunnel } from "@/lib/meta-pixel";

/** Mark a dedupe key as fired; returns false if it was already fired. */
function claim(dedupeKey?: string): boolean {
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
      const data: Record<string, unknown> = {};
      try {
        const res = await fetch("/api/cart", {
          cache: "no-store",
          credentials: "include",
        });
        if (res.ok) {
          const json = await res.json();
          const cart = (json?.data ?? json) as {
            subtotal?: number;
            currency?: string;
            items?: Array<{
              product_id?: string;
              variant_id?: string;
              id?: string;
              quantity?: number;
            }>;
          };
          const items = Array.isArray(cart?.items) ? cart.items : [];
          const ids = items
            .map((li) => li.product_id || li.variant_id || li.id)
            .filter((x): x is string => typeof x === "string");
          if (typeof cart?.subtotal === "number") data.value = cart.subtotal / 100;
          data.currency = cart?.currency || currency || "EGP";
          data.num_items = items.reduce(
            (n, li) => n + (Number(li.quantity) || 0),
            0,
          );
          if (ids.length) {
            data.content_ids = ids;
            data.content_type = "product";
            data.contents = items.map((li) => ({
              id: li.product_id || li.variant_id || li.id,
              quantity: Number(li.quantity) || 1,
            }));
          }
        }
      } catch {
        /* fire with whatever we have */
      }
      trackFunnel(step, data);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
