/**
 * Money formatting for the storefront.
 *
 * SAR renders the new official Saudi Riyal symbol (Unicode 17.0, U+20C1)
 * via the self-hosted "saudi_riyal" webfont (@font-face in globals.css);
 * Intl/CLDR still emits the old "ر.س"/"SAR". Every other currency goes
 * through Intl's currency style.
 */

// New Saudi Riyal sign, U+20C1.
const SAR_SYMBOL = "⃁";

/** Format an integer minor-unit amount (cents/halalas) for display. */
export function formatCents(cents: number | null | undefined, currency = "EGP"): string {
  const ccy = (currency || "EGP").toUpperCase();
  const v = (typeof cents === "number" && !Number.isNaN(cents) ? cents : 0) / 100;
  return formatMajor(v, ccy);
}

/** Format an amount already in major units. */
export function formatMajor(value: number, currency = "EGP"): string {
  const ccy = (currency || "EGP").toUpperCase();
  if (ccy === "SAR") {
    const num = new Intl.NumberFormat(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
    return `${SAR_SYMBOL} ${num}`;
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: ccy,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${ccy}`;
  }
}
