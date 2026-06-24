/**
 * Multi-step checkout state — Phase 1.2.
 *
 * Persists between checkout pages via sessionStorage so a refresh
 * doesn't drop the customer back to step 1. Cleared on success
 * (thank-you page) or explicit "leave checkout" navigation.
 *
 * NOT a substitute for server state — the backend `POST /checkout`
 * is single-shot and creates the order from a complete payload. This
 * lives only on the client and gets serialized into the final
 * request body on the review step.
 *
 * No cart line items here — the cart lives on the backend (Redis-
 * backed) and the final POST resolves line items from the cart
 * server-side. We only stash the form-collected fields.
 */

import type { CheckoutAddress } from "@/types/checkout";

const STORAGE_KEY = "numu_checkout_state";

export interface CheckoutState {
  // Step 1
  email: string;
  phone: string;
  shipping_address: Partial<CheckoutAddress>;
  // Step 2
  selected_shipping_rate_id: string | null;
  shipping_method: string | null;
  // Cached shipping cost (cents) of the selected rate so the order-summary
  // panel can show the Shipping line + Total without re-fetching all rates.
  // Pickup = 0. Re-resolved server-side on POST /checkout (this is display
  // only — the backend recomputes to prevent amount tampering).
  shipping_cost_cents: number | null;
  // Phase 7.2 — when set, the order is fulfilled as in-store pickup.
  // Mutually exclusive with selected_shipping_rate_id (a pickup order
  // has no shipping rate); PaymentStep clears one when the other is
  // picked. Cleared whenever the address changes.
  pickup_location_id: string | null;
  // Step 3
  payment_method: string | null;
  cod_requested: boolean;
  deposit_gateway: string | null;
  // Phase 7.5 — when set, the gateway service charges the stored
  // token instead of collecting a new card. Cleared whenever the
  // payment method changes (the resolver in PaymentStep handles it).
  saved_payment_method_id: string | null;
  // Step 4
  customer_notes: string;
  coupon_code: string;
  // Phase 8.3 — gift card tender. Up to 5 codes can be redeemed
  // against a single order; the backend FIFO-allocates the applied
  // amount up to min(sum_of_balances, total). Order's amount_due is
  // reduced by the applied amount; the gateway charges the remainder.
  gift_card_codes: string[];
  // Attribution (read from URL on entry)
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
}

export const EMPTY_CHECKOUT_STATE: CheckoutState = {
  email: "",
  phone: "",
  shipping_address: {},
  selected_shipping_rate_id: null,
  shipping_method: null,
  shipping_cost_cents: null,
  pickup_location_id: null,
  payment_method: null,
  cod_requested: false,
  deposit_gateway: null,
  saved_payment_method_id: null,
  customer_notes: "",
  coupon_code: "",
  gift_card_codes: [],
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
};

export function readCheckoutState(): CheckoutState {
  if (typeof window === "undefined") return { ...EMPTY_CHECKOUT_STATE };
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...EMPTY_CHECKOUT_STATE };
    const parsed = JSON.parse(raw);
    // Defensive merge — older versions of the schema may omit fields.
    return { ...EMPTY_CHECKOUT_STATE, ...parsed };
  } catch {
    return { ...EMPTY_CHECKOUT_STATE };
  }
}

export function writeCheckoutState(state: CheckoutState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage can throw in Safari private mode; swallow — the
    // worst case is the customer has to re-enter on next page.
  }
}

export function patchCheckoutState(patch: Partial<CheckoutState>): CheckoutState {
  const next = { ...readCheckoutState(), ...patch };
  writeCheckoutState(next);
  // Notify live UI that checkout state changed. The OrderSummary lives in the
  // persistent checkout LAYOUT (mounted once on the contact step) and only
  // re-reads on this event — without it, the Shipping line + Total never
  // reflect the rate the ShippingStep just selected (they'd stay at the
  // step-1 "calculated at the next steps" / subtotal-only state). Centralizing
  // the dispatch here covers every patch site (shipping, coupon, pickup, …).
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("numu:checkout:updated"));
  }
  return next;
}

export function clearCheckoutState(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

/**
 * True when step 1 is complete enough to proceed to shipping.
 * Used by step 2+ to redirect back if the customer deep-linked past
 * the contact step.
 */
export function hasContactStep(s: CheckoutState): boolean {
  return (
    Boolean(s.email) &&
    Boolean(s.shipping_address?.address_line1) &&
    Boolean(s.shipping_address?.city) &&
    Boolean(s.shipping_address?.country)
  );
}

export function hasShippingStep(s: CheckoutState): boolean {
  // Either a shipping rate OR a pickup-location is required to
  // proceed — both fulfillment modes are valid for advancing.
  return (
    hasContactStep(s) &&
    Boolean(s.selected_shipping_rate_id || s.pickup_location_id)
  );
}

export function hasPaymentStep(s: CheckoutState): boolean {
  return hasShippingStep(s) && Boolean(s.payment_method);
}
