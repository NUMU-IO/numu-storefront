/**
 * Floating WhatsApp click-to-chat button — host-shell chrome rendered above
 * ANY theme (built-in or BYOT), so it doesn't depend on a theme shipping its
 * own contact widget. It appears only when the merchant has added a WhatsApp
 * entry to the store's Social Links (`store.social_links.whatsapp`), so the
 * presence of that link is the on/off switch — no separate toggle.
 *
 * Server component: a static anchor with no client state. Mounted from
 * `[domain]/layout.tsx` next to the promo mounts.
 */

const GREETING: Record<"ar" | "en", (store: string) => string> = {
  ar: (store) => `مرحباً، لدي سؤال بخصوص ${store}`,
  en: (store) => `Hi! I have a question about ${store}`,
};

const LABEL: Record<"ar" | "en", string> = {
  ar: "تواصل معنا على واتساب",
  en: "Chat with us on WhatsApp",
};

// Country → international calling code, for turning a national number
// ("01060082542") into a wa.me-dialable one. Merchant hub stores the WhatsApp
// contact as whatever the merchant typed, which is often the local format with
// a leading trunk "0" and no country code. Covers NUMU's served markets; falls
// back to EG (the primary market) for anything unmapped.
const CALLING_CODE: Record<string, string> = {
  EG: "20", SA: "966", AE: "971", KW: "965", QA: "974", BH: "973", OM: "968",
  JO: "962", LB: "961", IQ: "964", YE: "967", PS: "970", SD: "249", LY: "218",
  TN: "216", DZ: "213", MA: "212", US: "1", GB: "44", TR: "90",
};

/** Normalize a phone value to international dialing digits (no "+"). Strips a
 * "00" intl access prefix and converts a leading national trunk "0" to the
 * store's country calling code. Returns null when there are no digits. */
export function toIntlDigits(raw: string, country?: string): string | null {
  let digits = (raw || "").replace(/\D/g, "");
  if (!digits) return null;
  const cc = CALLING_CODE[(country || "EG").toUpperCase()] || "20";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = cc + digits.slice(1);
  return digits || null;
}

/**
 * Turn a merchant-entered WhatsApp value into a click-to-chat href carrying the
 * greeting. Accepts a bare/formatted/national number ("01060082542",
 * "+20 100 123 4567") or a full link (wa.me/<num>, api.whatsapp.com/send?phone=).
 * A code-style link with no number (wa.me/message/<code>) is used verbatim.
 * Returns null when there's nothing dialable.
 */
export function toWhatsAppHref(
  raw: string,
  greeting: string,
  country?: string,
): string | null {
  const value = (raw || "").trim();
  if (!value) return null;
  const text = encodeURIComponent(greeting);
  let source = value;
  if (/^https?:\/\//i.test(value)) {
    const match = value.match(/(?:wa\.me\/|[?&]phone=)(\+?\d[\d\s-]*)/i);
    if (!match) return value; // e.g. wa.me/message/<code> — chat-link, use as-is
    source = match[1];
  }
  const digits = toIntlDigits(source, country);
  return digits ? `https://wa.me/${digits}?text=${text}` : null;
}

export function WhatsAppFloat({
  whatsapp,
  storeName,
  locale = "ar",
  country,
  raised = false,
}: {
  whatsapp: string;
  storeName: string;
  locale?: "ar" | "en";
  /** Store market (ISO 3166-1 alpha-2) — resolves a national number to intl. */
  country?: string;
  /** Lift above a promo floating widget sharing the bottom-end corner. */
  raised?: boolean;
}) {
  const lang: "ar" | "en" = locale === "ar" ? "ar" : "en";
  const href = toWhatsAppHref(
    whatsapp,
    GREETING[lang](storeName || "Store"),
    country,
  );
  if (!href) return null;

  // Bottom-end (right in LTR / left in RTL). `bottom-24` on mobile clears the
  // theme's fixed bottom nav bar, dropping to the corner on ≥sm. `raised`
  // stacks it above a promo floating pill when one occupies the same corner.
  const pos = raised
    ? "bottom-40 end-4 sm:bottom-20"
    : "bottom-24 end-4 sm:bottom-4";

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={LABEL[lang]}
      title={LABEL[lang]}
      className={`fixed ${pos} z-[55] flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg ring-1 ring-black/5 transition-transform duration-150 hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#25D366]`}
    >
      <svg
        viewBox="0 0 32 32"
        className="h-8 w-8"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M16.003 3.2C8.94 3.2 3.2 8.94 3.2 16c0 2.26.6 4.46 1.73 6.4L3.2 28.8l6.57-1.72A12.74 12.74 0 0 0 16 28.8h.01c7.06 0 12.8-5.74 12.8-12.8S23.06 3.2 16.003 3.2zm0 23.04h-.01a10.62 10.62 0 0 1-5.42-1.48l-.39-.23-4.03 1.06 1.07-3.93-.25-.4a10.6 10.6 0 0 1-1.62-5.66c0-5.87 4.78-10.64 10.66-10.64 2.85 0 5.52 1.11 7.53 3.13a10.56 10.56 0 0 1 3.12 7.52c0 5.87-4.78 10.64-10.65 10.64zm5.84-7.97c-.32-.16-1.9-.94-2.19-1.05-.29-.11-.5-.16-.72.16-.21.32-.82 1.05-1.01 1.26-.19.21-.37.24-.69.08-.32-.16-1.35-.5-2.57-1.59-.95-.85-1.59-1.9-1.78-2.22-.19-.32-.02-.5.14-.66.14-.14.32-.37.48-.56.16-.19.21-.32.32-.53.11-.21.05-.4-.03-.56-.08-.16-.72-1.74-.99-2.38-.26-.62-.52-.54-.72-.55l-.61-.01c-.21 0-.56.08-.85.4-.29.32-1.11 1.09-1.11 2.66 0 1.57 1.14 3.09 1.3 3.3.16.21 2.25 3.43 5.44 4.81.76.33 1.35.53 1.81.68.76.24 1.46.21 2.01.13.61-.09 1.9-.78 2.17-1.53.27-.75.27-1.39.19-1.53-.08-.14-.29-.22-.61-.38z" />
      </svg>
    </a>
  );
}
