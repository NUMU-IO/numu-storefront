/**
 * NumuDefaultShell — the branded surface for the host's DEFAULT / fallback
 * pages (404, "no content yet", error, and any route the active theme doesn't
 * template). Renders NUMU's house brand (navy + saffron + warm paper, the same
 * identity as the merchant hub) via the `--numu-*` tokens in globals.css, so a
 * page the theme leaves blank still reads as a polished, intentional NUMU
 * surface rather than bare gray. A themed store never reaches this — its own
 * template wins; this is only the backstop.
 *
 * Server component (no hooks) — safe to render from server fallbacks.
 */

import type { ReactNode } from "react";

export interface NumuDefaultShellProps {
  /** Large display heading (e.g. "404" or the page name). */
  title: ReactNode;
  /** Small saffron eyebrow above the title (e.g. a store or section label). */
  eyebrow?: ReactNode;
  /** Supporting copy under the title. */
  message?: ReactNode;
  /** Primary call-to-action (navy tactile button). */
  action?: { href: string; label: ReactNode };
  /** Extra branded content slotted below the message. */
  children?: ReactNode;
  /** Right-to-left (Arabic). */
  ar?: boolean;
  /** Fill the viewport (true for standalone 404/error; false when slotted
   *  inside theme chrome as a content placeholder). */
  fullScreen?: boolean;
}

export function NumuDefaultShell({
  title,
  eyebrow,
  message,
  action,
  children,
  ar = false,
  fullScreen = true,
}: NumuDefaultShellProps) {
  return (
    <div
      dir={ar ? "rtl" : "ltr"}
      className={`flex items-center justify-center bg-[var(--numu-paper)] px-4 [font-family:var(--numu-sans)] ${
        fullScreen ? "min-h-screen py-16" : "py-20"
      }`}
    >
      <div className="w-full max-w-lg rounded-[var(--numu-radius)] border border-[var(--numu-border)] bg-[var(--numu-surface)] p-8 text-center shadow-[0_22px_50px_-24px_rgba(12,45,84,0.32)] sm:p-10">
        {eyebrow && (
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-[var(--numu-saffron-600)]">
            {eyebrow}
          </p>
        )}
        <h1 className="text-3xl font-bold tracking-tight text-[var(--numu-ink)] [font-family:var(--numu-display)] sm:text-4xl">
          {title}
        </h1>
        {message && (
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-[var(--numu-ink-soft)] sm:text-base">
            {message}
          </p>
        )}
        {children}
        {action && (
          <a
            href={action.href}
            className="numu-btn-navy mt-7 inline-flex min-h-11 items-center justify-center rounded-full px-7 py-2.5 text-sm font-semibold"
          >
            {action.label}
          </a>
        )}
        <p className="mt-8 text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--numu-ink-soft)]/70">
          Powered by NUMU
        </p>
      </div>
    </div>
  );
}
