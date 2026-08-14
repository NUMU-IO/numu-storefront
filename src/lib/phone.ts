/**
 * Shared phone helpers for the storefront.
 *
 * One home for the country/dial-code data and the compose/normalize logic
 * that previously lived inline in CheckoutPage (dial-code dropdown) and
 * TrackLookup (EG normalizer). The identity dialog (phone-first OTP) is the
 * third consumer — three divergent phone inputs was already one too many.
 */

export const COUNTRIES = [
  ["EG", "Egypt", "مصر"],
  ["AE", "United Arab Emirates", "الإمارات"],
  ["SA", "Saudi Arabia", "السعودية"],
  ["KW", "Kuwait", "الكويت"],
  ["QA", "Qatar", "قطر"],
  ["BH", "Bahrain", "البحرين"],
  ["OM", "Oman", "عُمان"],
  ["JO", "Jordan", "الأردن"],
  ["LB", "Lebanon", "لبنان"],
] as const;

/** International dial codes keyed by the COUNTRIES code above. Default EG. */
export const DIAL: Record<string, string> = {
  EG: "+20",
  AE: "+971",
  SA: "+966",
  KW: "+965",
  QA: "+974",
  BH: "+973",
  OM: "+968",
  JO: "+962",
  LB: "+961",
};

/**
 * Combine the selected dial code with the typed local number into an E.164-ish
 * string for submission. Numbers the buyer already wrote in international form
 * (leading "+") are left untouched; otherwise the local trunk "0" is stripped
 * and the dial code prepended (e.g. EG + "01001234567" → "+201001234567").
 */
export function composePhone(cc: string, local: string): string {
  const trimmed = local.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) return trimmed.replace(/[\s()-]/g, "");
  const dial = DIAL[cc] || "";
  const national = trimmed.replace(/[\s()-]/g, "").replace(/^0+/, "");
  return dial ? `${dial}${national}` : national;
}

/** Egyptian mobile in local form: 01xxxxxxxxx. */
export const EG_MOBILE_RE = /^01\d{9}$/;

/**
 * Fold the common ways Egyptians write a mobile number — "0020…", "+20…",
 * "20…", spaced/dashed groups — down to the local "01xxxxxxxxx" form.
 * (Same implementation as TrackLookup's local copy.)
 */
export function normalizeEgPhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("0020")) return `0${digits.slice(4)}`;
  if (digits.startsWith("20") && digits.length === 12)
    return `0${digits.slice(2)}`;
  return digits;
}

/**
 * Light client-side shape check mirroring the backend's E.164 guard —
 * catches typos before an OTP round-trip, never replaces server validation.
 */
export function looksLikePhone(composed: string): boolean {
  return /^\+?\d{8,15}$/.test(composed.replace(/[\s()-]/g, ""));
}
