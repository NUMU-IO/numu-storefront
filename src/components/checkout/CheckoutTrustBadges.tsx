/**
 * CheckoutTrustBadges — the "trust network" strip shown on every step of
 * the built-in checkout (V2 parity).
 *
 * Server component (no hooks) — the checkout layout resolves the locale
 * once and passes it in, so there's no hydration flicker. Pure inline SVG
 * so it carries no icon-library dependency.
 *
 * Bilingual: English + Egyptian Arabic. The parent <main> already sets
 * `dir` via the root layout's <html dir>, so the row mirrors correctly in
 * RTL without extra work here.
 */

interface Badge {
  key: string;
  en: string;
  ar: string;
  icon: React.ReactNode;
}

const shield = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);
const truck = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 18V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h2" />
    <path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-2" />
    <circle cx="7.5" cy="18.5" r="2" />
    <circle cx="17.5" cy="18.5" r="2" />
  </svg>
);
const refresh = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);
const lock = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect width="18" height="11" x="3" y="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const BADGES: Badge[] = [
  { key: "secure", en: "Secure & encrypted", ar: "دفع آمن ومشفّر", icon: lock },
  { key: "cod", en: "Cash on delivery", ar: "الدفع عند الاستلام", icon: truck },
  { key: "returns", en: "Easy returns", ar: "استرجاع سهل", icon: refresh },
  { key: "protected", en: "Your data is protected", ar: "بياناتك في أمان", icon: shield },
];

export function CheckoutTrustBadges({ locale = "en" }: { locale?: string }) {
  const isAr = locale === "ar";
  return (
    <ul
      className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4"
      aria-label={isAr ? "ضمانات الشراء" : "Purchase guarantees"}
    >
      {BADGES.map((b) => (
        <li
          key={b.key}
          className="flex items-center gap-2.5 rounded-xl border border-gray-200/80 bg-white px-3.5 py-2.5 text-xs font-medium text-gray-600 shadow-sm"
        >
          <span className="shrink-0 text-gray-900">{b.icon}</span>
          <span>{isAr ? b.ar : b.en}</span>
        </li>
      ))}
    </ul>
  );
}
