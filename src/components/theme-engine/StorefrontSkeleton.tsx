/**
 * Shared storefront loading skeleton.
 *
 * Rendered in two places so the page is NEVER blank before the BYOT theme
 * bundle paints:
 *   1. `app/[domain]/loading.tsx` — the Next route-level Suspense fallback
 *      (navigation / first SSR wait).
 *   2. `ByotThemeBoundary` loading state — the client-side window while the
 *      theme bundle downloads + mounts (the gap the route skeleton can't see,
 *      since the page HTML has already been delivered by then).
 *
 * Plain presentational component (no hooks / no "use client") so it can be
 * imported from both server and client components. Theme-tinted via the same
 * CSS vars the bundle uses, so it inherits the store's palette.
 */
export default function StorefrontSkeleton() {
  const cards = Array.from({ length: 8 });
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading"
      aria-busy="true"
      className="min-h-screen bg-[var(--numu-paper)] [font-family:var(--numu-sans)] motion-safe:animate-pulse"
    >
      <span className="sr-only">Loading…</span>

      {/* Header bar: logo placeholder centered, icon placeholders right */}
      <div className="flex items-center justify-between border-b border-[var(--numu-navy)]/10 px-6 py-5">
        <div className="h-4 w-24 rounded bg-[var(--numu-navy)]/10" />
        <div className="mx-auto h-6 w-28 rounded bg-[var(--numu-navy)]/10" />
        <div className="flex gap-3">
          <div className="h-5 w-5 rounded-full bg-[var(--numu-navy)]/10" />
          <div className="h-5 w-5 rounded-full bg-[var(--numu-navy)]/10" />
          <div className="h-5 w-5 rounded-full bg-[var(--numu-navy)]/10" />
        </div>
      </div>

      {/* Page title + product grid placeholders */}
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8 h-7 w-48 rounded bg-[var(--numu-navy)]/10" />
        <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {cards.map((_, i) => (
            <div key={i} className="flex flex-col gap-3">
              <div className="aspect-[4/5] w-full rounded bg-[var(--numu-navy)]/10" />
              <div className="h-3 w-3/4 rounded bg-[var(--numu-navy)]/10" />
              <div className="h-3 w-1/3 rounded bg-[var(--numu-navy)]/10" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
