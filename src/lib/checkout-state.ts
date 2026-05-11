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
  // Step 3
  payment_method: string | null;
  cod_requested: boolean;
  deposit_gateway: string | null;
  // Step 4
  customer_notes: string;
  coupon_code: string;
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
  payment_method: null,
  cod_requested: false,
  deposit_gateway: null,
  customer_notes: "",
  coupon_code: "",
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
    Boolean(s.shipping_address?.line1) &&
    Boolean(s.shipping_address?.city) &&
    Boolean(s.shipping_address?.country)
  );
}

export function hasShippingStep(s: CheckoutState): boolean {
  return hasContactStep(s) && Boolean(s.selected_shipping_rate_id);
}

export function hasPaymentStep(s: CheckoutState): boolean {
  return hasShippingStep(s) && Boolean(s.payment_method);
}
