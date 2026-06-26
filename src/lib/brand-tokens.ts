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

type RGB = { r: number; g: number; b: number };

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

function toRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** WCAG relative luminance. */
function luminance({ r, g, b }: RGB): number {
  const a = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}

function contrastRatio(hex1: string, hex2: string): number {
  const L1 = luminance(toRgb(hex1));
  const L2 = luminance(toRgb(hex2));
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Pick whichever candidate reads best on `bg` (highest contrast). */
function bestTextOn(bg: string, candidates: Array<string | null>): string {
  const pool = [...candidates, "#0a0a14", "#ffffff"].filter(
    (c): c is string => !!c,
  );
  let best = "#ffffff";
  let score = -1;
  for (const c of pool) {
    const s = contrastRatio(bg, c);
    if (s > score) {
      score = s;
      best = c;
    }
  }
  return best;
}

function clampNum(
  v: unknown,
  min: number,
  max: number,
  fallback: number | null,
): number | null {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
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
  const primary = normHex(gs?.primary_color);
  const accent = normHex(gs?.accent_color);
  const bg = normHex(gs?.background_color);
  const fg = normHex(gs?.text_color);

  const radius = clampNum(gs?.corner_radius, 0, 40, null);
  const borderRaw = clampNum(gs?.card_border_width, 0, 8, null);
  const headingFont = fontStack(gs?.heading_font);
  const bodyFont = fontStack(gs?.body_font);

  // "Expressive" = the theme actually ships a brand identity. Only then do we
  // switch on the bold treatment (uppercase headings, amber CTA, souk frame);
  // otherwise the checkout stays the prior neutral premium look.
  const expressive = !!(primary || accent || (bg && fg));

  const surface = "#ffffff";
  const ckBg = bg ?? "#f8fafc";
  const ckFg = fg ?? "#111827";
  const muted = fg
    ? `color-mix(in srgb, ${fg} 52%, ${surface})`
    : "#6b7280";
  const softBorder = fg
    ? `color-mix(in srgb, ${fg} 14%, ${surface})`
    : "rgba(0,0,0,0.12)";

  // Card frame: a strong souk-print line when the theme asks for >=2px borders
  // (bazar), else the soft separator. Width drives the "hard border" feel.
  const bw = borderRaw == null ? 1 : borderRaw;
  const strongFrame = bw >= 2;
  const frame = strongFrame
    ? accent ?? fg ?? "#0a0a14"
    : softBorder;

  // CTA: the brand primary (amber for bazar) reads as the storefront's button,
  // with an automatically-contrasting label (ink on amber).
  const buttonBg = primary ?? fg ?? "#111827";
  const buttonText = bestTextOn(buttonBg, [fg, bg]);

  // Emphasis (selected states, eyebrows, free-ship hints): the primary.
  const emphasis = primary ?? accent ?? ckFg;
  const emphasisText = bestTextOn(emphasis, [fg, bg]);
  // Focus ring / structural accent: prefer the navy accent for contrast.
  const ring = accent ?? primary ?? ckFg;
  // Soft tint of the emphasis colour for selected backgrounds.
  const emphasisTint = `color-mix(in srgb, ${emphasis} 12%, ${surface})`;

  return {
    "--ck-bg": ckBg,
    "--ck-surface": surface,
    "--ck-surface-2": fg
      ? `color-mix(in srgb, ${fg} 4%, ${surface})`
      : "#f9fafb",
    "--ck-fg": ckFg,
    "--ck-muted": muted,
    "--ck-border": softBorder,
    "--ck-frame": frame,
    "--ck-frame-width": `${bw}px`,
    "--ck-radius": `${radius ?? 16}px`,
    "--ck-radius-sm": `${Math.max(0, (radius ?? 16) - 6)}px`,
    "--ck-accent": emphasis,
    "--ck-accent-text": emphasisText,
    "--ck-accent-tint": emphasisTint,
    "--ck-ring": ring,
    "--ck-button": buttonBg,
    "--ck-button-text": buttonText,
    // Flat (souk) cards when expressive; a soft shadow otherwise.
    "--ck-shadow": expressive ? "none" : "0 1px 2px 0 rgba(0,0,0,0.05)",
    // A thin brand bar at the very top of the checkout (amber for bazar).
    "--ck-topbar": expressive ? emphasis : "transparent",
    "--ck-heading-font": headingFont ?? "inherit",
    "--ck-heading-weight": expressive ? "800" : "600",
    "--ck-heading-transform": expressive ? "uppercase" : "none",
    "--ck-heading-tracking": expressive ? "-0.01em" : "0",
    "--ck-label-weight": expressive ? "700" : "500",
    "--ck-label-transform": expressive ? "uppercase" : "none",
    "--ck-label-tracking": expressive ? "0.1em" : "0",
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
