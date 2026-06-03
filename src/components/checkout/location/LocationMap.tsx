"use client";

import { useEffect, useRef } from "react";
import { loadGoogleMaps } from "./googleMapsLoader";
import type { Coords } from "./types";

const CAIRO: Coords = { lat: 30.0444, lng: 31.2357 };

export interface LocationMapProps {
  initialCoords?: Coords;
  onCenterChange: (coords: Coords) => void;
  /** Called when Google Maps fails to load (no key / blocked script). The
   *  dialog uses this to swap the map area for a graceful fallback. */
  onLoadError?: () => void;
}

export function LocationMap({
  initialCoords,
  onCenterChange,
  onLoadError,
}: LocationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const onCenterChangeRef = useRef(onCenterChange);
  const onLoadErrorRef = useRef(onLoadError);

  useEffect(() => {
    onCenterChangeRef.current = onCenterChange;
  }, [onCenterChange]);
  useEffect(() => {
    onLoadErrorRef.current = onLoadError;
  }, [onLoadError]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let idleListener: google.maps.MapsEventListener | null = null;
    let resizeObserver: ResizeObserver | null = null;

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !containerRef.current) return;

        const center = initialCoords ?? CAIRO;

        const map = new google.maps.Map(containerRef.current, {
          center,
          zoom: initialCoords ? 16 : 11,
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: "greedy",
          clickableIcons: false,
          mapId: undefined,
        });
        mapRef.current = map;

        idleListener = map.addListener("idle", () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            const c = map.getCenter();
            if (!c) return;
            onCenterChangeRef.current({ lat: c.lat(), lng: c.lng() });
          }, 250);
        });

        // Emit once at load so the dialog can fetch the initial address.
        const c = map.getCenter();
        if (c) {
          onCenterChangeRef.current({ lat: c.lat(), lng: c.lng() });
        }

        // The dialog animates open — if the container measured 0x0 when the
        // map was constructed, tiles never paint. Watch and trigger resize.
        resizeObserver = new ResizeObserver(() => {
          google.maps.event.trigger(map, "resize");
        });
        resizeObserver.observe(containerRef.current);
      })
      .catch((err) => {
        // No key / blocked script / invalid key — degrade gracefully. The
        // dialog falls back to manual entry; never crash the checkout.
        console.error("Failed to load Google Maps:", err);
        if (!cancelled) onLoadErrorRef.current?.();
      });

    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      if (idleListener) idleListener.remove();
      if (resizeObserver) resizeObserver.disconnect();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initialCoords || !mapRef.current) return;
    mapRef.current.panTo(initialCoords);
    if ((mapRef.current.getZoom() ?? 0) < 15) {
      mapRef.current.setZoom(16);
    }
  }, [initialCoords?.lat, initialCoords?.lng]);

  return (
    <div className="relative h-full w-full bg-gray-100">
      <style>{`
        .numu-pin-loader {
          width: 36px;
          height: 36px;
          position: relative;
          transform: rotate(45deg);
        }
        .numu-pin-loader::before,
        .numu-pin-loader::after {
          content: "";
          position: absolute;
          inset: 0;
          border-radius: 50% 50% 0 50%;
          background: #0000;
          background-image: radial-gradient(circle 9px at 50% 50%, #0000 94%, #ef4444);
        }
        .numu-pin-loader::after {
          animation: numu-pin-pulse 1s infinite;
          transform: perspective(280px) translateZ(0px);
        }
        @keyframes numu-pin-pulse {
          to {
            transform: perspective(280px) translateZ(140px);
            opacity: 0;
          }
        }
      `}</style>
      {/* `touch-manipulation` lets Google Maps own single-finger pan and
          two-finger pinch without iOS Safari hijacking them as page zoom.
          Complements the map's `gestureHandling: "greedy"`. */}
      <div ref={containerRef} className="absolute inset-0 touch-manipulation" />
      {/* Center pin overlay — visually offset up so the animated tip lands
          on the map center (the rotated teardrop's tip is ~25px below its
          layout center). */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-full"
      >
        <div className="numu-pin-loader" />
      </div>
    </div>
  );
}
