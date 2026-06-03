"use client";

import { useCallback, useState } from "react";
import type { Coords, GeoErrorCode } from "./types";

export type GeoState =
  | { status: "idle" }
  | { status: "requesting" }
  | { status: "success"; coords: Coords & { accuracy: number } }
  | { status: "error"; code: GeoErrorCode };

export function useGeolocation() {
  const [state, setState] = useState<GeoState>({ status: "idle" });

  const request = useCallback(() => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      setState({ status: "error", code: "unsupported" });
      return;
    }
    setState({ status: "requesting" });

    const tryGetPosition = (highAccuracy: boolean, timeout: number) =>
      new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: highAccuracy,
          timeout,
          maximumAge: 30_000,
        });
      });

    tryGetPosition(true, 8000)
      .catch(() => tryGetPosition(false, 4000))
      .then((pos) => {
        setState({
          status: "success",
          coords: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
          },
        });
      })
      .catch((err: GeolocationPositionError) => {
        const code: GeoErrorCode =
          err.code === err.PERMISSION_DENIED
            ? "denied"
            : err.code === err.TIMEOUT
              ? "timeout"
              : "unavailable";
        setState({ status: "error", code });
      });
  }, []);

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, request, reset };
}
