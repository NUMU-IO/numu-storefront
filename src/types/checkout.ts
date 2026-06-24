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
  // Field names match the backend's OrderAddressRequest exactly — the
  // payload is forwarded verbatim by /api/checkout, which has no aliases
  // (a `line1` key would be dropped and address_line1 would 422).
  address_line1: string;
  address_line2?: string | null;
  city: string;
  state?: string | null;
  postal_code?: string | null;
  country: string; // ISO 3166-1 alpha-2 (EG, US, etc.)
  phone?: string | null;
  // Cluster 2 — Google-Maps delivery pin. Captured by the checkout's
  // location picker and forwarded to the backend, which accepts these on
  // OrderAddressRequest (latitude/longitude/location_accuracy/
  // location_source/geocoded_address). Optional — checkout works without
  // a pin (manual entry), so they're only sent when the customer pins.
  latitude?: number;
  longitude?: number;
  location_accuracy?: number;
  location_source?: string; // "gps" | "manual_pin"
  geocoded_address?: string;
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
  // Provider-specific payload for client-side rendering, e.g. Kashier
  // ({ provider: "kashier", session_url, amount, currency }), InstaPay, Fawry.
  payment_data?: Record<string, unknown> | null;
  // Paymob Pixel embedded checkout credentials (card stores).
  paymob_client_secret?: string | null;
  paymob_public_key?: string | null;
}
