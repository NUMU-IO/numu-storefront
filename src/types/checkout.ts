/**
 * Storefront checkout types — Phase 1.2.
 *
 * Mirrors the Pydantic schemas in NUMU-api `schemas/storefront/checkout.py`.
 * Kept in this repo (not pulled from a shared package) because the
 * field set is small and stable; a generated type would be more
 * machinery than it saves.
 */

export interface CheckoutAddress {
  first_name: string;
  last_name: string;
  line1: string;
  line2?: string | null;
  city: string;
  state?: string | null;
  postal_code?: string | null;
  country: string; // ISO 3166-1 alpha-2 (EG, US, etc.)
  phone?: string | null;
}

export interface ShippingRateOption {
  id: string;
  name: string;
  amount_cents: number;
  currency: string;
  estimated_days_min?: number | null;
  estimated_days_max?: number | null;
  carrier?: string | null;
}

export interface CheckoutResponse {
  order_id: string;
  order_number: string;
  total: number;
  currency: string;
  payment_status: string;
  payment_url?: string | null;
  payment_data?: Record<string, unknown> | null;
}
