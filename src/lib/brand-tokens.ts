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

const FONT_STACKS: Record<string, string> = {
  inter: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  poppins: "'Poppins', system-ui, sans-serif",
  montserrat: "'Montserrat', system-ui, sans-serif",
  cairo: "'Cairo', system-ui, sans-serif",
  tajawal: "'Tajawal', system-ui, sans-serif",
};

function fontStack(v: unknown): string | null {
  if (typeof v !== "string") return null;
  return FONT_STACKS[v.trim().toLowerCase()] ?? null;
}

export type BrandVars = Record<string, string>;

/**
 * Resolve the `--ck-*` token set from a theme's global_settings.
 * Every token has a neutral fallback so an unbranded store renders as before.
 */
export function resolveBrandTokens(
  gs: Record<string, unknown> | null | undefined,
): BrandVars {
  // The storefront checkout uses ONE consistent design language, copied from
  // the bazaar checkout: a flat, sharp-cornered, monochrome BLACK look — no
  // rounded cards, no shadows, no per-store accent colour. We still read the
  // theme's page background + text colour + font so an Arabic store keeps its
  // Cairo type and warm canvas; everything structural is fixed black/flat.
  const bg =
    normHex(gs?.background_color) ?? normHex(gs?.bg_color);
  const fg =
    normHex(gs?.text_color) ?? normHex(gs?.foreground_color) ?? normHex(gs?.fg_color);
  const headingFont = fontStack(gs?.heading_font) ?? fontStack(gs?.font_family);
  const bodyFont = fontStack(gs?.body_font) ?? fontStack(gs?.font_family);

  const surface = "#ffffff";
  const ink = "#111111"; // the single checkout colour — black
  const ckBg = bg ?? "#efeeec";
  const ckFg = fg ?? ink;
  const muted = fg ? `color-mix(in srgb, ${fg} 50%, ${surface})` : "#6b7280";
  const softBorder = "rgba(0,0,0,0.16)";

  return {
    "--ck-bg": ckBg,
    "--ck-surface": surface,
    "--ck-surface-2": "#f7f7f6",
    "--ck-fg": ckFg,
    "--ck-muted": muted,
    "--ck-border": softBorder,
    // Card frame: a thin neutral line; selected cards use the black accent.
    "--ck-frame": softBorder,
    "--ck-frame-width": "1px",
    // Flat & sharp (bazaar): no rounding anywhere.
    "--ck-radius": "0px",
    "--ck-radius-sm": "0px",
    // Black emphasis for selected states / focus / CTA.
    "--ck-accent": ink,
    "--ck-accent-text": "#ffffff",
    "--ck-accent-tint": "color-mix(in srgb, #111111 5%, #ffffff)",
    "--ck-ring": ink,
    "--ck-button": ink,
    "--ck-button-text": "#ffffff",
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

/** Build a `:root{…}` CSS string so portaled overlays inherit the tokens. */
export function brandVarsToCss(vars: BrandVars, selector = ":root"): string {
  const body = Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  return `${selector}{${body}}`;
}
