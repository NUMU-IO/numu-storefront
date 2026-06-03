"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LocationMap } from "./LocationMap";
import { PlaceSearch, type PlacePickResult } from "./PlaceSearch";
import { useGeolocation } from "./useGeolocation";
import { useReverseGeocode } from "./useReverseGeocode";
import { reverseGeocode } from "./geocodeService";
import { locationLabels } from "./labels";
import {
  CheckIcon,
  CloseIcon,
  CrosshairIcon,
  MapPinIcon,
  ShieldCheckIcon,
  SpinnerIcon,
} from "./icons";
import type { CapturedLocation, Coords } from "./types";

export interface LocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (location: CapturedLocation) => void;
  locale?: string;
}

function accuracyBadge(accuracy: number, prefix: string) {
  const m = `~${Math.round(accuracy)}m`;
  if (accuracy <= 50)
    return {
      label: `${prefix} ${m}`,
      className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  if (accuracy <= 200)
    return {
      label: `${prefix} ${m}`,
      className: "bg-amber-50 text-amber-700 border-amber-200",
    };
  return {
    label: `${prefix} ${m}`,
    className: "bg-red-50 text-red-700 border-red-200",
  };
}

export function LocationDialog({
  open,
  onOpenChange,
  onConfirm,
  locale = "en",
}: LocationDialogProps) {
  const l = locationLabels(locale);
  const { state, request, reset } = useGeolocation();
  const [center, setCenter] = useState<Coords | null>(null);
  const [userMoved, setUserMoved] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [mounted, setMounted] = useState(false);
  // When the user picks a place via autocomplete, we (a) recenter the map
  // by feeding the new coords as `initialCoords`, and (b) remember the
  // structured address Google handed us so confirm can use it directly.
  const [searchCoords, setSearchCoords] = useState<Coords | null>(null);
  const [searchPick, setSearchPick] = useState<PlacePickResult | null>(null);
  const [confirming, setConfirming] = useState(false);

  const geocode = useReverseGeocode({
    lat: center?.lat,
    lng: center?.lng,
    enabled: open && !mapError,
  });

  // Portals need the DOM; only render the portal after mount.
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (open) {
      reset();
      setCenter(null);
      setUserMoved(false);
      setMapError(false);
      setSearchCoords(null);
      setSearchPick(null);
      request();
    }
  }, [open, reset, request]);

  // Lock body scroll + close on Escape while the modal is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  // A search pick overrides GPS — the customer explicitly chose a location.
  const initialCoords: Coords | undefined =
    searchCoords ??
    (state.status === "success"
      ? { lat: state.coords.lat, lng: state.coords.lng }
      : undefined);

  const handlePlacePicked = (pick: PlacePickResult) => {
    setSearchPick(pick);
    setSearchCoords(pick.coords);
    setUserMoved(true);
  };

  const handleCenterChange = (coords: Coords) => {
    setCenter(coords);
    if (state.status === "success") {
      const moved =
        Math.abs(coords.lat - state.coords.lat) > 0.00005 ||
        Math.abs(coords.lng - state.coords.lng) > 0.00005;
      if (moved) setUserMoved(true);
    } else {
      setUserMoved(true);
    }
  };

  const handleConfirm = async () => {
    if (!center || confirming) return;
    setConfirming(true);

    // Always do a fresh fetch on confirm so we hand the caller the latest
    // address data, even if the background query failed/was still running.
    // The backend mapping gives the storefront-normalized `city_code`
    // (matches the governorate dropdown) — Google autocomplete can't.
    let data = geocode.data;
    try {
      data = await reverseGeocode(center.lat, center.lng, "ar");
    } catch {
      // Geocoder unavailable — proceed with coords only; the customer can
      // fill the address fields manually.
    }

    // If the user picked a place via autocomplete and didn't drag the pin
    // far from it (~50m), prefer Google's structured parts for area/street/
    // formatted_address (more accurate than Nominatim in Egypt). Still take
    // `city_code` from the backend so the governorate dropdown autofills.
    const usedSearchPick =
      searchPick &&
      Math.abs(center.lat - searchPick.coords.lat) < 0.0005 &&
      Math.abs(center.lng - searchPick.coords.lng) < 0.0005;

    const source: CapturedLocation["source"] =
      state.status === "success" && !userMoved ? "gps" : "manual_pin";
    const accuracy =
      state.status === "success" && !userMoved ? state.coords.accuracy : 50;

    onConfirm({
      lat: center.lat,
      lng: center.lng,
      accuracy,
      source,
      formatted_address:
        (usedSearchPick ? searchPick?.formatted_address : null) ??
        data?.formatted_address ??
        undefined,
      city:
        (usedSearchPick ? searchPick?.city : null) ?? data?.city ?? undefined,
      city_code: data?.city_code,
      area:
        (usedSearchPick ? searchPick?.area : null) ?? data?.area ?? undefined,
      street:
        (usedSearchPick ? searchPick?.street : null) ??
        data?.street ??
        undefined,
    });
    setConfirming(false);
    onOpenChange(false);
  };

  const errorMessage = (() => {
    if (state.status !== "error") return null;
    switch (state.code) {
      case "denied":
        return l.errDenied;
      case "timeout":
        return l.errTimeout;
      case "unavailable":
        return l.errUnavailable;
      case "unsupported":
        return l.errUnsupported;
    }
  })();

  const badge =
    state.status === "success" && !userMoved
      ? accuracyBadge(state.coords.accuracy, l.accuracyPrefix)
      : null;

  const awaitingGeocode = Boolean(center) && geocode.isFetching && !geocode.data;
  const busy = awaitingGeocode || confirming;

  if (!mounted || !open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={l.dialogTitle}
      className="fixed inset-0 z-[9998] flex items-stretch justify-center sm:items-center sm:p-4"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
      />

      {/* Panel — full-bleed on mobile (100dvh shrinks for iOS chrome), a
          centered capped card on desktop. */}
      <div className="relative flex h-[100dvh] w-screen max-w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-[min(720px,90vh)] sm:max-h-[90vh] sm:w-[min(640px,95vw)] sm:rounded-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 bg-white px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-bold text-gray-900">
              <MapPinIcon size={16} />
              <span className="truncate">{l.dialogTitle}</span>
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-gray-500">
              <ShieldCheckIcon size={11} className="shrink-0" />
              <span className="truncate">{l.privacyNote}</span>
            </div>
          </div>
          {/* 44px tap target. */}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="-m-2 shrink-0 p-2 text-gray-400 transition-colors hover:text-gray-900"
            aria-label={l.close}
          >
            <CloseIcon size={20} />
          </button>
        </div>

        {/* Map area — min-h-0 lets the flex child shrink on short viewports
            so the footer never gets pushed off-screen. */}
        <div className="relative min-h-[280px] flex-1 sm:min-h-[420px] landscape:max-h-[60vh] landscape:min-h-[200px]">
          {mapError ? (
            // Graceful degradation — Maps failed to load (no key / blocked).
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gray-50 px-6 text-center">
              <MapPinIcon size={28} className="text-gray-300" />
              <p className="text-sm font-medium text-gray-700">
                {locale === "ar"
                  ? "تعذّر تحميل الخريطة"
                  : "Map couldn't be loaded"}
              </p>
              <p className="text-xs text-gray-500">
                {locale === "ar"
                  ? "أكمل طلبك بإدخال العنوان يدوياً."
                  : "Continue by entering your address manually."}
              </p>
            </div>
          ) : (
            <>
              <LocationMap
                initialCoords={initialCoords}
                onCenterChange={handleCenterChange}
                onLoadError={() => setMapError(true)}
              />
              {/* Search bar floats over the map. */}
              <div className="absolute inset-x-2 top-2 z-30 sm:inset-x-3 sm:top-3">
                <PlaceSearch
                  onPlacePicked={handlePlacePicked}
                  placeholder={l.searchPlaceholder}
                />
              </div>
              {/* Use-my-location FAB. */}
              <button
                type="button"
                onClick={() => {
                  setSearchCoords(null);
                  setSearchPick(null);
                  setUserMoved(false);
                  request();
                }}
                className="absolute bottom-3 end-3 z-30 inline-flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-semibold text-gray-900 shadow-lg ring-1 ring-black/5 transition-colors hover:bg-gray-50"
              >
                <CrosshairIcon size={15} />
                <span>{l.useMyLocation}</span>
              </button>
              {state.status === "requesting" && (
                <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/60 backdrop-blur-sm">
                  <div className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-medium shadow-sm">
                    <SpinnerIcon size={14} className="animate-spin" />
                    <span>{l.locating}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer — mt-auto pins it to the bottom even when the map shrinks. */}
        <div className="mt-auto shrink-0 space-y-3 border-t border-gray-100 bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {errorMessage && !mapError && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {errorMessage}
            </p>
          )}
          {center && !mapError && (
            <div className="space-y-1.5">
              {geocode.isFetching && !geocode.data ? (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <SpinnerIcon size={12} className="animate-spin" />
                  <span>{l.resolvingAddress}</span>
                </div>
              ) : geocode.data?.formatted_address ? (
                <>
                  <p
                    className="text-sm font-medium leading-snug text-gray-900"
                    dir="auto"
                  >
                    {geocode.data.formatted_address}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
                    {geocode.data.city && (
                      <span className="inline-flex items-center gap-1">
                        <MapPinIcon size={11} />
                        <span dir="auto">{geocode.data.city}</span>
                      </span>
                    )}
                    {badge && (
                      <span
                        className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 ${badge.className}`}
                      >
                        {badge.label}
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-xs text-gray-500">{l.dragHint}</p>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!center || busy || mapError}
            // Full-width on mobile with a generous 48px+ tap target.
            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gray-900 px-5 py-3 text-sm font-bold text-white transition-opacity hover:bg-gray-800 disabled:opacity-40 sm:w-auto"
          >
            {busy ? (
              <>
                <SpinnerIcon size={16} className="animate-spin" />
                {l.resolvingAddress}
              </>
            ) : (
              <>
                <CheckIcon size={16} />
                {l.confirmButton}
              </>
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
