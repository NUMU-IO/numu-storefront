"use client";

/**
 * Linear step progress for the checkout flow.
 *
 * Steps render as numbered pills with the active one highlighted.
 * No deep-link navigation — the customer can go back via a "back"
 * link on each page, but they can't jump forward past steps they
 * haven't completed (state machine in each page checks
 * hasContactStep / hasShippingStep before rendering).
 */

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const STEPS = [
  { key: "contact", label: "Contact" },
  { key: "shipping", label: "Shipping" },
  { key: "payment", label: "Payment" },
  { key: "review", label: "Review" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

export function StepIndicator({ current }: { current: StepKey }) {
  const activeIdx = STEPS.findIndex((s) => s.key === current);
  return (
    <ol
      className="flex items-center gap-2 mb-8"
      aria-label="Checkout progress"
    >
      {STEPS.map((s, i) => {
        const done = i < activeIdx;
        const active = i === activeIdx;
        return (
          <li key={s.key} className="flex items-center gap-2">
            <span
              className={cn(
                "w-6 h-6 rounded-full inline-flex items-center justify-center text-xs font-medium",
                done && "bg-gray-900 text-white",
                active && "bg-gray-900 text-white",
                !done && !active && "bg-gray-200 text-gray-600",
              )}
              aria-current={active ? "step" : undefined}
            >
              {i + 1}
            </span>
            <span
              className={cn(
                "text-sm",
                (active || done) && "text-gray-900 font-medium",
                !active && !done && "text-gray-500",
              )}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && (
              <span aria-hidden className="text-gray-300">
                ›
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
