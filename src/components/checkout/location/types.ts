export interface Coords {
  lat: number;
  lng: number;
}

export interface CapturedLocation {
  lat: number;
  lng: number;
  accuracy: number;
  source: "gps" | "manual_pin";
  /** Provider-normalized formatted address (persisted as `geocoded_address`). */
  formatted_address?: string;
  /** Governorate display name as returned by the geocoder/Google. */
  city?: string;
  /** Governorate slug matching the checkout dropdown ('Cairo' | 'Giza' | …). */
  city_code?: string;
  /** Neighborhood / district within the city. */
  area?: string;
  /** Street name + number. */
  street?: string;
}

export type GeoErrorCode = "denied" | "unavailable" | "timeout" | "unsupported";
