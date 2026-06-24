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
    <div className="flex items-center gap-3 rounded-[var(--ck-radius-sm,0.75rem)] border-[length:var(--ck-frame-width,1px)] border-[var(--ck-accent,#10b981)] bg-[var(--ck-accent-tint,#ecfdf5)] p-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--ck-button,#059669)] text-[var(--ck-button-text,#fff)]">
        <MapPinIcon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-[var(--ck-fg,#064e3b)]">
          {l.pinnedChipTitle}
        </p>
        <p className="truncate text-[11px] text-[var(--ck-muted,#065f46)]" dir="auto">
          {subtitle}
        </p>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="shrink-0 text-[11px] font-semibold text-[var(--ck-accent,#064e3b)] underline underline-offset-2 transition-[filter] hover:brightness-90"
      >
        {l.edit}
      </button>
      <button
        type="button"
        onClick={onClear}
        className="shrink-0 p-1 text-[var(--ck-muted,#6b7280)] transition-colors hover:text-red-600"
        aria-label={l.clear}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}
