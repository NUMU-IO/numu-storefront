"use client";

import { useEffect, useRef, useState } from "react";
import {
  GeocodeUnavailableError,
  reverseGeocode,
  type GeocodeResult,
} from "./geocodeService";

export interface UseReverseGeocodeArgs {
  lat: number | undefined;
  lng: number | undefined;
  /** Disable the query entirely (e.g. while the map is still loading). */
  enabled?: boolean;
}

export interface UseReverseGeocodeResult {
  data: GeocodeResult | undefined;
  isFetching: boolean;
  isUnavailable: boolean;
  error: Error | null;
}

// Module-level memo so repeated pans over the same building (rounded to
// ~1m) don't refetch, mirroring the React-Query staleTime the V2 hook had.
// Keyed by `lat,lng,lang`. Lives for the page session.
const cache = new Map<string, GeocodeResult>();
const unavailableSeen = { value: false };

/**
 * Effect-based reverse-geocode hook (the V2 bazaar used React Query; the
 * Next storefront ships no query lib, so this is a hand-rolled equivalent
 * with the same surface). Fires whenever lat/lng settle, aborts in-flight
 * requests on change/unmount, and caches by rounded coords.
 */
export function useReverseGeocode({
  lat,
  lng,
  enabled = true,
}: UseReverseGeocodeArgs): UseReverseGeocodeResult {
  const [data, setData] = useState<GeocodeResult | undefined>(undefined);
  const [isFetching, setIsFetching] = useState(false);
  const [isUnavailable, setIsUnavailable] = useState(unavailableSeen.value);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const latR = lat !== undefined ? Number(lat.toFixed(5)) : undefined;
  const lngR = lng !== undefined ? Number(lng.toFixed(5)) : undefined;
  const key =
    latR !== undefined && lngR !== undefined ? `${latR},${lngR},ar` : null;

  useEffect(() => {
    if (
      !enabled ||
      key === null ||
      latR === undefined ||
      lngR === undefined
    ) {
      return;
    }

    // Backend already told us geocoding is off — don't keep hammering it.
    if (unavailableSeen.value) {
      setIsUnavailable(true);
      return;
    }

    const cached = cache.get(key);
    if (cached) {
      setData(cached);
      setError(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsFetching(true);
    setError(null);

    reverseGeocode(latR, lngR, "ar", controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        cache.set(key, result);
        setData(result);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof GeocodeUnavailableError) {
          unavailableSeen.value = true;
          setIsUnavailable(true);
        } else if (err instanceof Error && err.name !== "AbortError") {
          setError(err);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsFetching(false);
      });

    return () => controller.abort();
  }, [key, enabled, latR, lngR]);

  return { data, isFetching, isUnavailable, error };
}
