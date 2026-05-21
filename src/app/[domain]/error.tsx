"use client";

/**
 * Storefront error boundary — Phase 5.7 WCAG-AA.
 *
 * Accessibility decisions:
 *   - role="alert" announces the failure immediately to screen
 *     readers (assertive politeness — interrupts the current task,
 *     correct for an error state).
 *   - The "Try again" button is the first focusable element so
 *     keyboard users land on it without tabbing through the page.
 *   - Color contrast: red-700 on white = 5.94:1 (exceeds AA 4.5:1).
 *     The original `text-red-600` (4.83:1 in current Tailwind) was
 *     borderline; we tightened to red-700 for safety.
 *   - Error messages are NOT announced via aria-live separately —
 *     the role="alert" wrapper already handles that. Doubling up
 *     causes screen readers to announce the message twice.
 */
export default function StoreError({
  error,
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <main
      role="alert"
      aria-labelledby="error-title"
      className="min-h-screen flex items-center justify-center px-4"
    >
      <div className="text-center max-w-md">
        <h1
          id="error-title"
          className="text-2xl font-bold text-red-700"
        >
          Something went wrong
        </h1>
        {error.message && (
          <p className="text-gray-700 mt-2">{error.message}</p>
        )}
        <button
          type="button"
          onClick={reset}
          autoFocus
          className="mt-6 inline-flex items-center justify-center rounded-md bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
