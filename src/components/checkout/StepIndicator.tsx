"use client";

/**
 * Linear step progress for the checkout flow.
 *
 * Steps render as numbered pills with the active one highlighted and
 * completed ones showing a check. No deep-link navigation — the customer
 * goes back via a "back" link on each page but can't jump forward past
 * steps they haven't completed (each page's state machine gates that).
 *
 * Bilingual (en + Egyptian Arabic) + RTL-safe: the connector lines use a
 * neutral flex layout that mirrors automatically under <html dir="rtl">.
 */

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const STEPS = [
  { key: "contact", en: "Contact", ar: "البيانات" },
  { key: "shipping", en: "Shipping", ar: "الشحن" },
  { key: "payment", en: "Payment", ar: "الدفع" },
  { key: "review", en: "Review", ar: "المراجعة" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

function CheckMark() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function StepIndicator({
  current,
  locale = "en",
}: {
  current: StepKey;
  locale?: string;
}) {
  const isAr = locale === "ar";
  const activeIdx = STEPS.findIndex((s) => s.key === current);
  return (
    <nav aria-label={isAr ? "تقدّم إتمام الطلب" : "Checkout progress"} className="mb-6 sm:mb-8">
      <ol className="flex items-center">
        {STEPS.map((s, i) => {
          const done = i < activeIdx;
          const active = i === activeIdx;
          const isLast = i === STEPS.length - 1;
          return (
            <li
              key={s.key}
              className={cn("flex items-center", !isLast && "flex-1")}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors",
                    (done || active) &&
                      "bg-[var(--ck-button)] text-[var(--ck-button-text)]",
                    !done &&
                      !active &&
                      "border-[length:var(--ck-frame-width)] border-[var(--ck-frame)] bg-[var(--ck-surface)] text-[var(--ck-muted)]",
                  )}
                  aria-current={active ? "step" : undefined}
                >
                  {done ? <CheckMark /> : i + 1}
                </span>
                <span
                  className={cn(
                    "whitespace-nowrap text-[11px] [letter-spacing:var(--ck-label-tracking)] [text-transform:var(--ck-label-transform)] sm:text-xs",
                    // On narrow phones only the ACTIVE step keeps its label, so
                    // the 4-step row never overflows (uppercase labels + circles
                    // + connectors don't fit at 360px). From `sm` up, all show.
                    active ? "inline" : "hidden sm:inline",
                    (active || done)
                      ? "text-[var(--ck-fg)] [font-weight:var(--ck-label-weight)]"
                      : "text-[var(--ck-muted)]",
                  )}
                >
                  {isAr ? s.ar : s.en}
                </span>
              </div>
              {!isLast && (
                <span
                  aria-hidden
                  className={cn(
                    "mx-2 h-px flex-1 sm:mx-3",
                    done ? "bg-[var(--ck-button)]" : "bg-[var(--ck-border)]",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
