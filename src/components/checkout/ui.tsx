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

/** A premium content card — soft border, rounded-2xl, subtle shadow. */
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
        "rounded-2xl border border-gray-200/80 bg-white p-5 shadow-sm sm:p-6",
        className,
      )}
    >
      {(title || description) && (
        <div className="mb-4">
          {title && (
            <h2
              id={ariaLabelledBy}
              className="text-base font-semibold tracking-tight text-gray-900 sm:text-lg"
            >
              {title}
            </h2>
          )}
          {description && (
            <p className="mt-1 text-sm text-gray-500">{description}</p>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

const FIELD_INPUT =
  "block w-full rounded-lg border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-sm outline-none transition-colors placeholder:text-gray-400 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/10 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-60";

/** Labeled field wrapper. `span` className keeps label copy consistent. */
export function Field({
  label,
  htmlFor,
  className,
  children,
  hint,
}: {
  label: ReactNode;
  htmlFor?: string;
  className?: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className={cn("block", className)}>
      <span className="mb-1.5 block text-sm font-medium text-gray-700">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-xs text-gray-400">{hint}</span>}
    </label>
  );
}

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
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-gray-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 disabled:cursor-not-allowed disabled:opacity-50",
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
      className="inline-flex items-center gap-1 text-sm font-medium text-gray-500 underline-offset-4 transition-colors hover:text-gray-900 hover:underline"
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
        "flex cursor-pointer items-center gap-3 rounded-xl border p-3.5 transition-colors",
        selected
          ? "border-gray-900 bg-gray-50 ring-1 ring-gray-900"
          : "border-gray-200 hover:border-gray-300 hover:bg-gray-50",
        className,
      )}
    >
      {children}
    </label>
  );
}
