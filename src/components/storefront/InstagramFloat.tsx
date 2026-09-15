/**
 * Floating Instagram button — host-shell chrome like WhatsAppFloat, rendered
 * above any theme. Off by default: it shows only when the theme's settings turn
 * it on (`global_settings.show_instagram_float`) AND the merchant has an
 * Instagram entry in the store's Social Links. When the WhatsApp button is also
 * showing, it sits directly above it in the same corner.
 *
 * Server component: a static anchor with no client state.
 */

const LABEL: Record<"ar" | "en", string> = {
  ar: "تابعنا على إنستجرام",
  en: "Follow us on Instagram",
};

const HANDLE = /^[A-Za-z0-9._]{1,30}$/;

/**
 * Turn a merchant-entered Instagram value into a profile URL. Accepts "@handle",
 * "handle", "instagram.com/handle" or a full instagram.com / instagr.am link.
 * Returns null for anything that isn't an Instagram destination.
 */
export function toInstagramHref(raw: string): string | null {
  const value = (raw || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || /^(www\.|m\.)?(instagram\.com|instagr\.am)\//i.test(value)) {
    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      if (!/(^|\.)instagram\.com$|^instagr\.am$/i.test(url.hostname)) return null;
      const path = url.pathname.replace(/\/+$/, "");
      return path ? `https://www.instagram.com${path}/` : null;
    } catch {
      return null;
    }
  }
  const handle = value.replace(/^@/, "");
  return HANDLE.test(handle) ? `https://www.instagram.com/${handle}/` : null;
}

export function InstagramFloat({
  instagram,
  locale = "ar",
  raised = false,
  aboveWhatsApp = false,
}: {
  instagram: string;
  locale?: "ar" | "en";
  /** Lift above a promo floating widget sharing the bottom-end corner. */
  raised?: boolean;
  /** The WhatsApp button is showing, so take the slot directly above it. */
  aboveWhatsApp?: boolean;
}) {
  const href = toInstagramHref(instagram);
  if (!href) return null;
  const lang: "ar" | "en" = locale === "ar" ? "ar" : "en";

  // Same corner and spacing as WhatsAppFloat; one 3.5rem button + 1rem gap
  // higher when WhatsApp occupies the corner slot.
  const pos = aboveWhatsApp
    ? raised
      ? "bottom-[14.5rem] end-4 sm:bottom-[9.5rem]"
      : "bottom-[10.5rem] end-4 sm:bottom-[5.5rem]"
    : raised
      ? "bottom-40 end-4 sm:bottom-20"
      : "bottom-24 end-4 sm:bottom-4";

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={LABEL[lang]}
      title={LABEL[lang]}
      className={`fixed ${pos} z-[55] flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg ring-1 ring-black/5 transition-transform duration-150 hover:scale-105 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d6249f]`}
      style={{
        background:
          "radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #285aeb 90%)",
      }}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-7 w-7"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <circle cx="12" cy="12" r="4" />
        <circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    </a>
  );
}
