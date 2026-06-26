"use client";

import { MapPinIcon } from "./icons";
import { locationLabels } from "./labels";

export interface LocationButtonProps {
  onClick: () => void;
  hasLocation?: boolean;
  locale?: string;
}

export function LocationButton({
  onClick,
  hasLocation,
  locale = "en",
}: LocationButtonProps) {
  const l = locationLabels(locale);
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-center gap-3 rounded-[var(--ck-radius-sm,0.75rem)] border border-dashed border-[var(--ck-frame,#d1d5db)] bg-[var(--ck-surface-2,#f9fafb)] p-4 text-start transition-colors hover:border-[var(--ck-accent,#111827)] hover:bg-[var(--ck-accent-tint,#f3f4f6)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ck-ring,#111827)]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--ck-button,#111827)] text-[var(--ck-button-text,#fff)]">
        <MapPinIcon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-[var(--ck-fg,#111827)]">
          {hasLocation ? l.buttonTitleEdit : l.buttonTitle}
        </span>
        <span className="mt-0.5 block text-xs text-[var(--ck-muted,#6b7280)]">
          {l.buttonSubtitle}
        </span>
      </span>
      <span className="shrink-0 text-xs font-semibold text-[var(--ck-accent,#111827)] underline underline-offset-2">
        {hasLocation ? l.buttonActionEdit : l.buttonAction}
      </span>
    </button>
  );
}
