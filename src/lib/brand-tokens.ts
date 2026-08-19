/**
 * brand-tokens — derive a full checkout/overlay design language from the
 * active theme's `global_settings`.
 *
 * The platform checkout (and the host-rendered cookie banner + map picker)
 * are owned by the host, not the theme bundle, so they can't import the
 * theme's CSS. Instead we read the theme's brand globals server-side and map
 * them onto a rich set of `--ck-*` CSS custom properties: not just colours,
 * but border weight, corner radius, button shape, heading weight/transform
 * and font stacks. The components consume those tokens, so an expressive
 * theme like bazar (amber primary, navy accent, 2px souk-print card borders,
 * Inter-900 uppercase headings) makes the checkout genuinely *look* like the
 * store — while a bare store with no brand colours falls back to the previous
 * neutral palette exactly. Engine-based: no per-theme code.
 *
 * Keys read (bazar's settings_schema ids; any V3 theme that follows the same
 * Brand/Typography/Layout convention lights up automatically):
 *   primary_color · accent_color · background_color · text_color
 *   corner_radius · card_border_width · heading_font · body_font
 */

/** Parse #rgb / #rrggbb / #rgba / #rrggbbaa into a normalized #rrggbb, else null. */
export function normHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^#?([0-9a-fA-F]{3,8})$/.exec(v.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4)
    h = h
      .slice(0, 3)
      .split("")
      .map((c) => c + c)
      .join("");
  if (h.length === 8 || h.length === 4) h = h.slice(0, 6);
  if (h.length !== 6) return null;
  return `#${h.toLowerCase()}`;
}

const SANS = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

const FONT_STACKS: Record<string, string> = {
  inter: `'Inter', ${SANS}`,
  poppins: `'Poppins', ${SANS}`,
  montserrat: `'Montserrat', ${SANS}`,
  cairo: `'Cairo', ${SANS}`,
  tajawal: `'Tajawal', ${SANS}`,
  // Serif faces the V3 themes actually ship with. Their absence was not
  // cosmetic: an unmapped name fell through to `inherit`, so a store whose
  // whole identity is a serif got the checkout in the host's sans and read as
  // a different site. Vionne (cormorant + lora) is exactly that case.
  cormorant: `'Cormorant Garamond', 'Cormorant', ${SERIF}`,
  "cormorant-garamond": `'Cormorant Garamond', 'Cormorant', ${SERIF}`,
  lora: `'Lora', ${SERIF}`,
  playfair: `'Playfair Display', ${SERIF}`,
  "playfair-display": `'Playfair Display', ${SERIF}`,
  "dm-serif": `'DM Serif Display', ${SERIF}`,
  marcellus: `'Marcellus', ${SERIF}`,
  "libre-baskerville": `'Libre Baskerville', ${SERIF}`,
  "crimson-pro": `'Crimson Pro', ${SERIF}`,
  jost: `'Jost', ${SANS}`,
  outfit: `'Outfit', ${SANS}`,
  manrope: `'Manrope', ${SANS}`,
  "dm-sans": `'DM Sans', ${SANS}`,
  "work-sans": `'Work Sans', ${SANS}`,
  raleway: `'Raleway', ${SANS}`,
  lato: `'Lato', ${SANS}`,
  rubik: `'Rubik', ${SANS}`,
  almarai: `'Almarai', ${SANS}`,
  "ibm-plex-sans-arabic": `'IBM Plex Sans Arabic', ${SANS}`,
};

// These values are merchant-controlled and land inside a `<style>` block, so
// anything that could terminate a declaration or open a rule has to be
// impossible. Family names legitimately need letters, digits, spaces, hyphens,
// dots, commas and quotes — and nothing else. `;` `{` `}` `(` `)` `<` `>` `\`
// and `/` are all absent by construction, which rules out both breaking out of
// the declaration and smuggling in a `url(...)`.
const SAFE_FONT_VALUE = /^[\w\s'",.-]{2,120}$/;

function fontStack(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const raw = v.trim();
  if (!raw) return null;

  const key = raw.toLowerCase();
  const hit = FONT_STACKS[key] ?? FONT_STACKS[key.replace(/\s+/g, "-")];
  if (hit) return hit;

  if (!SAFE_FONT_VALUE.test(raw)) return null;

  // Some themes (genova) store a COMPLETE css font-family list rather than a
  // key — `"Instrument Sans", "Manrope", system-ui, sans-serif`. Passing that
  // through verbatim is both correct and the only way those stores' checkouts
  // match their own type; quoting it as a single family name would produce a
  // family that does not exist.
  if (raw.includes(",")) return raw;

  // A single unrecognised family: quote it and let the generic stack carry it.
  return `'${raw.replace(/["']/g, "")}', ${SANS}`;
}

// ── Contrast ──────────────────────────────────────────────────────────
// A brand accent is safe as a *border* at any darkness, but a solid fill with
// text on top is not. Vionne's accent is gold (#D4AF37): against white text it
// lands near 1.9:1, far under the 4.5:1 body-text floor, so promoting it to the
// pay button would produce a beautiful, unreadable CTA. These two helpers keep
// that decision mechanical instead of a matter of taste.

function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const srgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}

/** WCAG contrast ratio between two normalized #rrggbb colors. */
export function contrastRatio(a: string, b: string): number {
  const [la, lb] = [relativeLuminance(a), relativeLuminance(b)];
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The readable text color to sit on `bg` — whichever of white/near-black wins. */
function onColor(bg: string): string {
  return contrastRatio(bg, "#ffffff") >= contrastRatio(bg, "#111111")
    ? "#ffffff"
    : "#111111";
}

/**
 * The Google-hosted families we may request, keyed by the same setting value
 * the themes store. Anything absent here simply isn't fetched — the stack in
 * FONT_STACKS still names it, so a locally-installed copy is used and the
 * generic fallback covers everyone else.
 */
const GOOGLE_FAMILIES: Record<string, string> = {
  inter: "Inter:wght@400;500;600;700",
  poppins: "Poppins:wght@400;500;600;700",
  montserrat: "Montserrat:wght@400;500;600;700",
  cairo: "Cairo:wght@400;500;600;700",
  tajawal: "Tajawal:wght@400;500;700",
  cormorant: "Cormorant+Garamond:wght@400;500;600;700",
  "cormorant-garamond": "Cormorant+Garamond:wght@400;500;600;700",
  lora: "Lora:wght@400;500;600;700",
  playfair: "Playfair+Display:wght@400;500;600;700",
  "playfair-display": "Playfair+Display:wght@400;500;600;700",
  "dm-serif": "DM+Serif+Display",
  marcellus: "Marcellus",
  "libre-baskerville": "Libre+Baskerville:wght@400;700",
  "crimson-pro": "Crimson+Pro:wght@400;500;600;700",
  jost: "Jost:wght@400;500;600;700",
  outfit: "Outfit:wght@400;500;600;700",
  manrope: "Manrope:wght@400;500;600;700",
  "dm-sans": "DM+Sans:wght@400;500;600;700",
  "work-sans": "Work+Sans:wght@400;500;600;700",
  raleway: "Raleway:wght@400;500;600;700",
  lato: "Lato:wght@400;700",
  rubik: "Rubik:wght@400;500;600;700",
  almarai: "Almarai:wght@400;700",
  "ibm-plex-sans-arabic": "IBM+Plex+Sans+Arabic:wght@400;500;600;700",
};

/**
 * Stylesheet URL for the store's heading + body faces, or null.
 *
 * Checkout suspends the theme's own CSS (`SuspendExternalThemeCss`), which is
 * what keeps a theme bundle from restyling the payment form — but it also means
 * the theme's webfonts never arrive. Without this the tokens NAME the store's
 * typeface and the browser quietly renders the generic fallback, so a serif
 * store gets "a serif" rather than *its* serif.
 */
export function brandFontHref(
  gs: Record<string, unknown> | null | undefined,
): string | null {
  const pick = (v: unknown) =>
    typeof v === "string" ? GOOGLE_FAMILIES[v.trim().toLowerCase()] : undefined;
  const families = [
    pick(gs?.heading_font) ?? pick(gs?.font_family),
    pick(gs?.body_font) ?? pick(gs?.font_family),
  ].filter((f, i, a): f is string => Boolean(f) && a.indexOf(f) === i);
  if (!families.length) return null;
  return (
    "https://fonts.googleapis.com/css2?" +
    families.map((f) => `family=${f}`).join("&") +
    "&display=swap"
  );
}

export type BrandVars = Record<string, string>;

/**
 * Resolve the `--ck-*` token set from a theme's global_settings.
 * Every token has a neutral fallback so an unbranded store renders as before.
 */
export function resolveBrandTokens(
  gs: Record<string, unknown> | null | undefined,
): BrandVars {
  // The checkout keeps ONE structural design language — flat, sharp-cornered,
  // one dark CTA. That part is deliberate: a checkout whose *shape* changes per
  // store is a checkout nobody can QA once.
  //
  // What it should NOT do is arrive in a different palette and a different
  // typeface from the store the shopper was just browsing. That was happening
  // for a plain reason: this function only read `background_color` /
  // `text_color`, and the V3 themes name those `color_white` / `color_ink`. So
  // a live store like Vionne — white canvas, near-black ink, gold accent,
  // Cormorant + Lora — resolved every single token to the generic fallback and
  // rendered beige-on-sans. Not a design decision; a key-name mismatch.
  //
  // Both conventions are read below. `background_color` first so any store
  // already relying on it keeps its exact rendering.
  const bg =
    normHex(gs?.background_color) ??
    normHex(gs?.bg_color) ??
    normHex(gs?.color_white) ??
    normHex(gs?.color_bg);
  const fg =
    normHex(gs?.text_color) ??
    normHex(gs?.foreground_color) ??
    normHex(gs?.fg_color) ??
    normHex(gs?.color_ink);
  const mutedBrand = normHex(gs?.muted_color) ?? normHex(gs?.color_muted);
  const borderBrand = normHex(gs?.border_color) ?? normHex(gs?.color_border);
  const accentBrand = normHex(gs?.accent_color) ?? normHex(gs?.primary_color);
  const headingFont = fontStack(gs?.heading_font) ?? fontStack(gs?.font_family);
  const bodyFont = fontStack(gs?.body_font) ?? fontStack(gs?.font_family);

  const surface = "#ffffff";
  const ink = "#111111";
  const ckBg = bg ?? "#efeeec";
  const ckFg = fg ?? ink;
  const muted =
    mutedBrand ?? (fg ? `color-mix(in srgb, ${fg} 50%, ${surface})` : "#6b7280");
  const softBorder = borderBrand
    ? `color-mix(in srgb, ${borderBrand} 70%, transparent)`
    : "rgba(0,0,0,0.16)";

  // The brand accent marks *choice* — the selected card, the focus ring, the
  // step you are on. It is deliberately NOT promoted to the CTA fill: many
  // brand accents (Vionne's gold among them) cannot carry white text at 4.5:1,
  // and a gorgeous unreadable Pay button is a worse outcome than a plain one.
  // The CTA stays the store's own ink, which is what these themes use for
  // buttons anyway — Vionne literally labels `color_ink` "Primary text & buttons".
  const accentReadable =
    accentBrand && contrastRatio(accentBrand, surface) >= 1.6 ? accentBrand : null;
  const ckAccent = accentReadable ?? ckFg;
  const button = fg ?? ink;

  return {
    "--ck-bg": ckBg,
    "--ck-surface": surface,
    // Derived from the INK, not the background. Mixing the page background
    // toward white gives a white store a "raised" surface identical to its
    // base — the hover state would be invisible on exactly the cleanest
    // palettes. A few percent of the store's own text colour always reads.
    "--ck-surface-2": `color-mix(in srgb, ${ckFg} 4%, ${surface})`,
    "--ck-fg": ckFg,
    "--ck-muted": muted,
    "--ck-border": softBorder,
    // Card frame: a thin neutral line; selected cards use the accent.
    "--ck-frame": softBorder,
    "--ck-frame-width": "1px",
    // Flat & sharp: no rounding anywhere.
    "--ck-radius": "0px",
    "--ck-radius-sm": "0px",
    "--ck-accent": ckAccent,
    "--ck-accent-text": onColor(ckAccent),
    "--ck-accent-tint": `color-mix(in srgb, ${ckAccent} 8%, ${surface})`,
    // A hairline of the accent for selected borders — enough to read as chosen
    // without the row shouting.
    "--ck-accent-line": `color-mix(in srgb, ${ckAccent} 55%, ${surface})`,
    "--ck-ring": ckAccent,
    "--ck-button": button,
    "--ck-button-text": onColor(button),
    "--ck-shadow": "none",
    "--ck-topbar": "transparent",
    "--ck-heading-font": headingFont ?? "inherit",
    "--ck-heading-weight": "800",
    // Section headings (ORDER SUMMARY / DELIVERY DETAILS / PAYMENT METHOD) are
    // uppercase; field labels keep their natural Title Case.
    "--ck-heading-transform": "uppercase",
    "--ck-heading-tracking": "0.04em",
    "--ck-label-weight": "700",
    "--ck-label-transform": "none",
    "--ck-label-tracking": "0.02em",
    "--ck-body-font": bodyFont ?? "inherit",
  };
}

/**
 * Motion that ships alongside the tokens, because it animates them.
 *
 * One rule only: confirming a choice. Picking a payment method is the moment
 * the shopper commits, and a marker that simply blinks into existence gives
 * them nothing to confirm against — the eye misses it and they re-check. A
 * 160ms settle is long enough to be seen and short enough that nobody in a
 * hurry is made to wait for it.
 *
 * Deliberately no page-load choreography: checkout loads into a task.
 */
const CHECKOUT_MOTION = `
.ck-selected-dot{animation:ck-pop 160ms cubic-bezier(.22,1,.36,1)}
@keyframes ck-pop{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}
@media (prefers-reduced-motion: reduce){
.ck-selected-dot{animation:none}
.ck-option{transition-duration:1ms}
}`;

/** Build a `:root{…}` CSS string so portaled overlays inherit the tokens. */
export function brandVarsToCss(vars: BrandVars, selector = ":root"): string {
  const body = Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  return `${selector}{${body}}${selector === ":root" ? CHECKOUT_MOTION : ""}`;
}
