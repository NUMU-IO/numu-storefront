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
      className="group flex w-full items-center gap-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-start transition-colors hover:border-gray-900 hover:bg-gray-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white">
        <MapPinIcon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-gray-900">
          {hasLocation ? l.buttonTitleEdit : l.buttonTitle}
        </span>
        <span className="mt-0.5 block text-xs text-gray-500">
          {l.buttonSubtitle}
        </span>
      </span>
      <span className="shrink-0 text-xs font-semibold text-gray-900 underline underline-offset-2">
        {hasLocation ? l.buttonActionEdit : l.buttonAction}
      </span>
    </button>
  );
}
