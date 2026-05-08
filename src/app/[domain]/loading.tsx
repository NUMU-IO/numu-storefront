/**
 * Storefront loading state — Phase 5.7 WCAG-AA.
 *
 * Accessibility decisions:
 *   - role="status" + aria-live="polite" announces the loading
 *     state to screen readers without interrupting their current
 *     task.
 *   - Visible spinner uses sufficient contrast (text-gray-600 on
 *     white = 5.74:1, exceeds AA 4.5:1).
 *   - The animation respects prefers-reduced-motion via Tailwind's
 *     motion-safe variant — assistive tech users with vestibular
 *     sensitivity see a static placeholder instead of a pulse.
 */
export default function StoreLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      className="min-h-screen flex items-center justify-center px-4"
    >
      <div className="flex items-center gap-3 text-gray-600 motion-safe:animate-pulse">
        <svg
          className="h-5 w-5"
          aria-hidden="true"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="3"
          />
          <path
            d="M22 12a10 10 0 0 1-10 10"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
        <span className="text-sm font-medium">Loading…</span>
      </div>
    </div>
  );
}
