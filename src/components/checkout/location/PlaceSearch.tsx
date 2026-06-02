"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "./googleMapsLoader";
import { SearchIcon, SpinnerIcon } from "./icons";
import type { Coords } from "./types";

export interface PlacePickResult {
  coords: Coords;
  formatted_address: string | null;
  /** Governorate / admin_area_level_1 — display name as returned by Google. */
  city: string | null;
  /** Locality / sublocality / area within the city. */
  area: string | null;
  /** Street name + number, joined. */
  street: string | null;
}

export interface PlaceSearchProps {
  onPlacePicked: (result: PlacePickResult) => void;
  placeholder: string;
}

/**
 * Google Places Autocomplete bound to an <input>.
 *
 * Uses the legacy `google.maps.places.Autocomplete` widget (still
 * supported as of 2026) rather than `PlaceAutocompleteElement` — the
 * legacy widget integrates cleanly with React refs and lets us style the
 * trigger like the rest of the dialog's inputs.
 */
export function PlaceSearch({ onPlacePicked, placeholder }: PlaceSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onPickedRef = useRef(onPlacePicked);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onPickedRef.current = onPlacePicked;
  }, [onPlacePicked]);

  useEffect(() => {
    let cancelled = false;
    let listener: google.maps.MapsEventListener | null = null;
    let autocomplete: google.maps.places.Autocomplete | null = null;

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !inputRef.current) return;

        autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
          // Egypt-only — the storefront serves Egyptian merchants.
          componentRestrictions: { country: ["eg"] },
          fields: [
            "geometry.location",
            "formatted_address",
            "address_components",
            "name",
          ],
        });

        listener = autocomplete.addListener("place_changed", () => {
          const place = autocomplete!.getPlace();
          const loc = place.geometry?.location;
          if (!loc) return;

          const components = place.address_components ?? [];
          const get = (type: string) =>
            components.find((c) => c.types.includes(type))?.long_name ?? null;

          const streetNumber = get("street_number");
          const route = get("route");
          const street = [streetNumber, route].filter(Boolean).join(" ") || null;

          onPickedRef.current({
            coords: { lat: loc.lat(), lng: loc.lng() },
            formatted_address: place.formatted_address ?? place.name ?? null,
            city:
              get("administrative_area_level_1") ??
              get("locality") ??
              get("administrative_area_level_2"),
            area:
              get("sublocality") ??
              get("sublocality_level_1") ??
              get("neighborhood") ??
              get("locality"),
            street,
          });

          // Clear the input so the next search starts fresh.
          if (inputRef.current) inputRef.current.value = "";
        });

        setReady(true);
      })
      .catch((err) => {
        // No key / blocked — the dialog already handles the fallback; the
        // search input just stays disabled.
        console.error("Places Autocomplete failed to load:", err);
      });

    return () => {
      cancelled = true;
      if (listener) listener.remove();
    };
  }, []);

  return (
    <div className="relative">
      {/* The autocomplete dropdown (`.pac-container`) is portaled to <body>
          by Google. Our modal sits high in the stack, so bump pac-container
          above it. Mobile-first: 44px tap targets, 15px query text. */}
      <style>{`
        .pac-container { z-index: 10000 !important; box-shadow: 0 8px 24px rgba(0,0,0,0.18); border-radius: 8px; margin-top: 4px; border: none; }
        .pac-item { padding: 12px 12px; font-size: 14px; line-height: 1.3; cursor: pointer; min-height: 44px; display: flex; align-items: center; border-top: 1px solid #f3f4f6; }
        .pac-item:first-child { border-top: none; }
        .pac-item-query { font-size: 15px; font-weight: 600; }
        .pac-icon { margin-top: 0; }
      `}</style>
      <span className="pointer-events-none absolute inset-y-0 start-3 flex items-center text-gray-400">
        <SearchIcon size={16} />
      </span>
      <input
        ref={inputRef}
        type="text"
        autoComplete="off"
        inputMode="search"
        enterKeyHint="search"
        placeholder={placeholder}
        disabled={!ready}
        // h-11 (44px) = iOS HIG min tap target. text-base on mobile avoids
        // iOS Safari's 16px input zoom-on-focus; desktop tightens to text-sm.
        className="w-full h-11 ps-10 pe-3 text-base sm:text-sm rounded-lg border border-gray-200 bg-white shadow-md outline-none transition-colors focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10 disabled:opacity-50"
        dir="auto"
      />
      {!ready && (
        <span className="absolute inset-y-0 end-3 flex items-center text-gray-400">
          <SpinnerIcon size={16} className="animate-spin" />
        </span>
      )}
    </div>
  );
}
