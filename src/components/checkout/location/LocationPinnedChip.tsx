"use client";

import { CloseIcon, MapPinIcon } from "./icons";
import { locationLabels } from "./labels";
import type { CapturedLocation } from "./types";

export interface LocationPinnedChipProps {
  location: CapturedLocation;
  onEdit: () => void;
  onClear: () => void;
  locale?: string;
}

export function LocationPinnedChip({
  location,
  onEdit,
  onClear,
  locale = "en",
}: LocationPinnedChipProps) {
  const l = locationLabels(locale);
  const subtitle =
    location.formatted_address ??
    `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
        <MapPinIcon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-emerald-900">
          {l.pinnedChipTitle}
        </p>
        <p className="truncate text-[11px] text-emerald-800/80" dir="auto">
          {subtitle}
        </p>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="shrink-0 text-[11px] font-semibold text-emerald-900 underline underline-offset-2 hover:text-emerald-700"
      >
        {l.edit}
      </button>
      <button
        type="button"
        onClick={onClear}
        className="shrink-0 p-1 text-emerald-700/70 transition-colors hover:text-red-600"
        aria-label={l.clear}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}
