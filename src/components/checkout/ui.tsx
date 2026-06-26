"use client";

/**
 * Shared presentational primitives for the platform (built-in) checkout.
 *
 * These give every step a consistent, premium look — polished cards,
 * refined inputs with uniform focus states, and primary/secondary
 * buttons — without changing any step's logic. Steps keep their own
 * state/validation/gating; they just render through these.
 *
 * RTL-safe by construction: spacing uses logical Tailwind utilities
 * (`ps-*`/`pe-*`/`ms-*`/`text-start`) so the layout mirrors correctly
 * when the root <html dir="rtl"> is set for Arabic.
 */

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import Link from "next/link";

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/**
 * A content card. Frame weight + corner radius + flat/shadow come from the
 * active theme's `--ck-*` tokens, so bazar renders a flat 2px souk-print frame
 * while a neutral store keeps the soft rounded-2xl shadowed card.
 */
export function CheckoutCard({
  title,
  description,
  children,
  className,
  "aria-labelledby": ariaLabelledBy,
}: {
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <section
      aria-labelledby={ariaLabelledBy}
      className={cn(
        "rounded-[var(--ck-radius)] border-[length:var(--ck-frame-width)] border-[var(--ck-frame)] bg-[var(--ck-surface)] p-5 [box-shadow:var(--ck-shadow)] sm:p-6",
        className,
      )}
    >
      {(title || description) && (
        <div className="mb-4">
          {title && (
            <h2
              id={ariaLabelledBy}
              className="text-base text-[var(--ck-fg)] [font-family:var(--ck-heading-font)] [font-weight:var(--ck-heading-weight)] [letter-spacing:var(--ck-heading-tracking)] [text-transform:var(--ck-heading-transform)] sm:text-lg"
            >
              {title}
            </h2>
          )}
          {description && (
            <p className="mt-1 text-sm text-[var(--ck-muted)]">{description}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

const FIELD_INPUT =
  "block w-full rounded-[var(--ck-radius-sm)] border-[length:var(--ck-frame-width)] border-[var(--ck-frame)] bg-[var(--ck-surface)] px-3.5 py-2.5 text-sm text-[var(--ck-fg)] outline-none transition-colors placeholder:text-[var(--ck-muted)] focus:border-[var(--ck-ring)] focus:ring-2 focus:ring-[var(--ck-ring)]/25 disabled:cursor-not-allowed disabled:opacity-60";

/** Labeled field wrapper. `span` className keeps label copy consistent. */
export function Field({
  label,
  htmlFor,
  className,
  children,
  hint,
  error,
  required,
}: {
  label: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
  hint?: ReactNode;
  /** Inline validation message — shown in place of the hint when present. */
  error?: ReactNode;
  /** Show a required-field asterisk before the label. */
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className={cn("block", className)}>
      <span className="mb-1.5 block text-xs text-[var(--ck-fg)] [font-weight:var(--ck-label-weight)] [letter-spacing:var(--ck-label-tracking)] [text-transform:var(--ck-label-transform)]">
        {required ? <span className="text-red-500" aria-hidden>* </span> : null}
        {label}
      </span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs font-medium text-red-600" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-[var(--ck-muted)]">{hint}</span>
      ) : null}
    </label>
  );
}

/** Red-border class for an invalid input — pass to TextInput/Select `className`. */
export const INPUT_INVALID =
  "border-red-400 focus:border-red-500 focus:ring-red-500/25";

export function TextInput({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(FIELD_INPUT, className)} />;
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cn(FIELD_INPUT, "appearance-none bg-white", className)}>
      {children}
    </select>
  );
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(FIELD_INPUT, "resize-y", className)} />;
}

/** Primary action button — solid, prominent, with a busy state. */
export function PrimaryButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={cn(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--ck-button)] px-7 py-2.5 text-sm font-bold uppercase tracking-wide text-[var(--ck-button-text)] transition-[filter,opacity] hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ck-ring)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** Subtle "back" link used at the bottom of each step. */
export function BackLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-sm font-medium text-[var(--ck-muted)] underline-offset-4 transition-colors hover:text-[var(--ck-fg)] hover:underline"
    >
      <span aria-hidden>‹</span>
      <span>{children}</span>
    </Link>
  );
}

/** Inline error banner (role=alert). */
export function ErrorBanner({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="mt-0.5 shrink-0"
      >
        <circle cx="12" cy="12" r="10" />
        <line x1="12" x2="12" y1="8" y2="12" />
        <line x1="12" x2="12.01" y1="16" y2="16" />
      </svg>
      <span className="whitespace-pre-wrap">{children}</span>
    </div>
  );
}

/** A selectable option row (radio-card) — used for shipping/payment lists. */
export function OptionRow({
  htmlFor,
  selected,
  children,
  className,
}: {
  htmlFor?: string;
  selected?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn(
        "flex cursor-pointer items-center gap-3 rounded-[var(--ck-radius-sm)] border-[length:var(--ck-frame-width)] p-3.5 transition-colors",
        selected
          ? "border-[var(--ck-accent)] bg-[var(--ck-accent-tint)]"
          : "border-[var(--ck-frame)] hover:border-[var(--ck-accent)]",
        className,
      )}
    >
      {children}
    </label>
  );
}
