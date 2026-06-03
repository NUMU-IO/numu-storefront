/**
 * Reverse-geocoding client for the checkout location picker.
 *
 * Calls the storefront's own `/api/storefront/geocode/reverse` proxy
 * (which resolves the store from the host and forwards to NUMU-api). The
 * upstream provider key stays server-side and results are Redis-cached.
 *
 * Unlike the V2 bazaar — which called the backend directly via an
 * `API_URL` env helper — the Next storefront has no client-readable API
 * base, so we go through the same `/api/*` proxy layer the cart/customer
 * routes use.
 */

export type GovernorateSlug =
  | "Cairo"
  | "Giza"
  | "Alexandria"
  | "Mansoura"
  | "Tanta"
  | "Asyut"
  | "Sohag"
  | "Other";

export interface GeocodeResult {
  formatted_address: string | null;
  city: string | null;
  city_code: GovernorateSlug;
  area: string | null;
  street: string | null;
  country_code: string | null;
  latitude: number;
  longitude: number;
  provider: "nominatim" | "locationiq";
}

/** Thrown (logically) when the backend has no geocoder configured (503). */
export class GeocodeUnavailableError extends Error {
  constructor() {
    super("Reverse geocoding is not configured on the server.");
    this.name = "GeocodeUnavailableError";
  }
}

export async function reverseGeocode(
  lat: number,
  lng: number,
  lang: "ar" | "en" = "ar",
  signal?: AbortSignal,
): Promise<GeocodeResult> {
  const qs = new URLSearchParams({
    lat: String(lat),
    lng: String(lng),
    lang,
  }).toString();

  const res = await fetch(`/api/storefront/geocode/reverse?${qs}`, {
    cache: "no-store",
    signal,
  });

  if (res.status === 503) {
    throw new GeocodeUnavailableError();
  }
  if (!res.ok) {
    throw new Error(`Geocoding failed (${res.status})`);
  }

  const json = await res.json();
  return (json?.data ?? json) as GeocodeResult;
}
