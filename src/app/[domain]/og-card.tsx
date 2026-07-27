/**
 * Generated Open Graph cards — the shared kit behind `opengraph-image.tsx`.
 *
 * WHY THIS EXISTS: a store that never uploaded a social image emitted no
 * `og:image` at all, so every WhatsApp / Facebook / X share of that store (and
 * of any product without a photo) rendered as a blank grey card. WhatsApp is
 * the dominant sharing channel for Egyptian commerce, so that blank card is a
 * conversion surface, not a vanity item.
 *
 * PRECEDENCE — the merchant's own image still wins. Next only applies a
 * file-convention `opengraph-image` when the SAME segment's `generateMetadata`
 * did not set `openGraph.images` (`mergeStaticMetadata` in
 * next/dist/lib/metadata/resolve-metadata.js checks
 * `source.openGraph.hasOwnProperty('images')`). `[domain]/layout.tsx` builds
 * its OG block with `buildOpenGraph`, which assigns `images` ONLY when
 * `storeSocialImage(store)` returned something (social_image_url › banner_url ›
 * logo_url). So: merchant image set → their image; nothing set → the key is
 * absent → this generated card fills the hole. Nothing here overrides a
 * merchant upload, and no change to seo.ts / generateMetadata is needed.
 *
 * ── The awkward parts of `ImageResponse`, and what we do about them ─────────
 *
 * 1. NO CSS. The renderer (satori) never sees globals.css, so every style is
 *    inline and the NUMU house-brand tokens are duplicated as literals in
 *    `BRAND` below — kept byte-identical to the `--numu-*` custom properties
 *    in `src/app/globals.css`.
 *
 * 2. FONTS. `ImageResponse` ships exactly one font (Geist Regular, Latin) and
 *    passing a `fonts` array REPLACES it rather than extending it. We do not
 *    pass one: the only file in `public/fonts/` is `saudi_riyal.woff2`, which
 *    is (a) WOFF2 — satori parses ttf/otf/woff only — and (b) a single-glyph
 *    webfont. So the cards deliberately render in the bundled Latin default.
 *
 * 3. ARABIC IS DELIBERATELY NOT RENDERED. This is the uncomfortable one, since
 *    most NUMU stores are Arabic-first. Measured against this exact
 *    next/og build:
 *      - satori implements no bidi reordering. "متجر ياسمين" renders as
 *        "رجتم نيمساي" — visually shaped, logically backwards, i.e. gibberish
 *        to an Arabic reader. `direction: rtl` changes nothing (byte-identical
 *        output).
 *      - required Arabic ligatures THROW inside the shaper: any lam-alef
 *        ("للأزياء") raises `lookupType: 5 - substFormat: 3 is not yet
 *        supported` and takes the whole render down.
 *    A font with Arabic coverage does NOT fix either — both are shaper bugs,
 *    not coverage gaps. So `latinSafe()` strips Arabic from every string that
 *    reaches satori and the card falls back to Latin-safe copy (the subdomain
 *    wordmark when a name is Arabic-only). The merchant's LOGO still renders,
 *    and merchant logos usually carry the Arabic name as artwork — which is
 *    the closest thing to an Arabic card we can ship today. Revisit when
 *    satori gains bidi.
 *
 * 4. EMOJI. satori resolves emoji by fetching an SVG from a CDN, and that one
 *    branch of its asset loader is NOT wrapped in a try/catch — a blocked
 *    egress turns a store named "Yalla 🇪🇬" into a failed render. `latinSafe()`
 *    strips pictographs too, so a card never depends on outbound network for
 *    its TEXT.
 *
 * 5. WEBP. satori draws PNG/APNG/JPEG/GIF and nothing else, while every image
 *    NUMU's R2 pipeline stores is `.webp` — so the platform's default image is
 *    one the renderer cannot use (and one that CRASHES it when inlined as a
 *    data URI). `fetchCardImage` transcodes through sharp, which ships as an
 *    optionalDependency of Next itself; if it is missing the card just loses
 *    the picture. Details on both at `SATORI_MIME` / `loadSharp`.
 *
 * 6. NEVER 500. `ImageResponse` renders lazily inside a ReadableStream, so a
 *    satori throw surfaces mid-stream — after the response headers are gone —
 *    and a `try` around the constructor catches nothing. `renderOgCard` drains
 *    the stream to a buffer first, which turns that into an ordinary catchable
 *    rejection, then degrades: full card › text-only card › 1×1 PNG. A share
 *    preview may be plain, but it is never a 500.
 */

import { ImageResponse } from "next/og";
import { formatMajor } from "@/lib/money";
import type { ReactElement } from "react";

/** Open Graph's canonical card size — what WhatsApp/Facebook/X crop against. */
export const OG_SIZE: { width: number; height: number } = {
  width: 1200,
  height: 630,
};
export const OG_CONTENT_TYPE = "image/png";

/**
 * NUMU house brand, mirrored from the `--numu-*` tokens in globals.css.
 * satori cannot read CSS custom properties (see the header note), so these
 * literals must be kept in sync with that block by hand.
 */
const BRAND = {
  navy: "#0c2d54",
  navy700: "#163a64",
  saffron: "#e8a430",
  paper: "#fbf6ed",
  cream: "#f5efe6",
  /** Not a token: paper knocked back over navy, pre-mixed as a solid hex so
   *  the secondary lines don't rely on alpha compositing. */
  paperSoft: "#b9c6d6",
} as const;

// ── Text sanitising ─────────────────────────────────────────────────────────

/*
 * The character-class patterns in this file are built with `new RegExp` rather
 * than regex literals, for two reasons: `\p{…}` property escapes are a compile
 * error at this repo's `target: ES2017` (the runtime supports them fine), and
 * an invisible or right-to-left character sitting inside a literal is
 * unreviewable in a diff and one bad editor save away from mojibake.
 */

/**
 * The whole Arabic script — letters, Arabic-Indic digits, punctuation and the
 * presentation-form blocks.
 *
 * `Script_Extensions`, not `Script`: several Arabic diacritics (the shadda in
 * "تسوّق", for one) carry Script=Inherited, so the narrower property leaves
 * orphaned combining marks behind. Those marks are invisible in a diff but not
 * to satori — it treats each one as an uncovered glyph and goes off to fetch a
 * fallback font over the network, which is how a card that should render in
 * 40ms took 5s on its first hit.
 */
const ARABIC_RE = new RegExp("\\p{Script_Extensions=Arabic}", "gu");

/** Emoji and their modifiers/joiners. */
const PICTOGRAPH_RE = new RegExp(
  "[\\p{Extended_Pictographic}\\u{1F3FB}-\\u{1F3FF}\\u{FE0F}\\u{200D}]",
  "gu",
);

/** Zero-width + explicit bidi controls: invisible here, but they still take
 *  part in shaping and can only make satori's output stranger. */
const INVISIBLE_RE = new RegExp(
  "[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069]",
  "g",
);

/**
 * Everything drawn on a card goes through here. See note 3/4 in the header:
 * Arabic would render backwards (or throw), emoji would depend on a CDN.
 * Returns "" when nothing printable survives — callers pick their own fallback.
 */
export function latinSafe(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(ARABIC_RE, " ")
    .replace(PICTOGRAPH_RE, " ")
    .replace(INVISIBLE_RE, "")
    .replace(/\s+/g, " ")
    // Strip the punctuation the stripping itself orphans: "تسوّق من ياسمين —
    // تشكيلة." collapses to "— ." and a card must not print a lone dash-dot.
    .replace(/^[\s\-–—·|,/.:;•]+|[\s\-–—·|,/:;•]+$/g, "")
    .replace(/\s+\.$/, "")
    .trim();
}

/** Hard-truncate at a word boundary. satori's line-clamp support is partial,
 *  and an over-long name that wraps past the card is worse than an ellipsis. */
export function clampText(raw: string, max: number): string {
  const s = raw.trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  const body = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}…`;
}

/** Single-letter mark for the no-logo / no-image case. */
export function monogram(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    const m = latinSafe(c).match(/[A-Za-z0-9]/);
    if (m) return m[0].toUpperCase();
  }
  return "N";
}

/**
 * The new Saudi Riyal sign (U+20C1) that `@/lib/money` emits for SAR. No font
 * available to satori carries it — verified: it renders as a tofu box — so the
 * card spells the ISO code instead.
 */
const SAR_SIGN = new RegExp("\\u20C1", "g");

/**
 * Price for a card, via the storefront's ONE money formatter (`formatMajor`).
 *
 * Amounts are passed in MAJOR units because that is what the API boundary
 * hands us: `normalizeProduct` in api-client.ts coerces the backend's
 * Decimal-as-string `"230.00"` straight through — product prices are NOT cents
 * here (cart/order totals are, and those go through `formatCents`).
 *
 * The Intl fallback covers a server whose default locale is Arabic: `Intl`
 * would then emit Arabic-Indic digits and "ج.م.", which `latinSafe` strips
 * down to nothing. If no digit survives, re-format in en-US so the card always
 * shows a readable number.
 */
export function ogPrice(amount: number, currency: string): string {
  const ccy = (currency || "EGP").toUpperCase();
  const sanitized = latinSafe(formatMajor(amount, ccy).replace(SAR_SIGN, "SAR"));
  if (/\d/.test(sanitized)) return sanitized;
  const num = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${num} ${ccy}`;
}

// ── Remote images (store logo / product photo) ──────────────────────────────

/**
 * What satori can actually draw: PNG, APNG, JPEG, GIF. That is its whole
 * supported list (`qI` in the compiled bundle) — NOT the wider set its mime
 * table suggests.
 *
 * WEBP AND AVIF ARE NOT RENDERABLE, and that matters here more than anywhere
 * else: NUMU's R2 upload pipeline stores merchant logos and product photos as
 * `.webp`, so the default case for this platform is an image satori refuses.
 * Handed the URL it logs "Unsupported image type: image/webp" and silently
 * drops the image; handed the same bytes as a data URI it throws
 * `TypeError: u2 is not iterable` and takes the card down with it. Hence
 * `normalizeForSatori` below, which transcodes before satori ever sees it.
 *
 * SVG is excluded deliberately: satori parses intrinsic dimensions from the
 * markup and a viewBox-only export (what most logo tooling emits) leaves the
 * size undefined and crashes the same way.
 */
const SATORI_MIME = new Set([
  "image/png",
  "image/apng",
  "image/jpeg",
  "image/gif",
]);

/** Formats we can still USE, by transcoding first. */
const FETCHABLE_MIME = new Set([...SATORI_MIME, "image/webp", "image/avif"]);

/**
 * Above this, re-encode even a satori-native image: the bytes are base64'd
 * into the SVG that satori builds, so a 3MB product photo is ~4MB of string
 * to shuttle through the rasteriser for an image that is never drawn wider
 * than 1120px.
 */
const NORMALIZE_ABOVE_BYTES = 600 * 1024;

/** Loopback / link-local / RFC-1918 literals. These URLs come from the store
 *  record (merchant-editable), never from the visitor, so this is not an open
 *  proxy — but a logo_url pointed at 169.254.169.254 should still not be a
 *  request this server makes. */
const PRIVATE_HOST_RE =
  /^(?:localhost|127\.|0\.|10\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i;

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/**
 * An absolute http(s) image URL this server is willing to touch, or null.
 *
 * Shared by the fetcher and by the store route's "hand the merchant's own
 * social image back instead" redirect, so both apply the same rule to the same
 * merchant-supplied strings.
 */
export function safeImageUrl(raw: string | null | undefined): URL | null {
  const src = (raw ?? "").trim();
  if (!src || src.startsWith("data:")) return null;
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    // Relative asset (theme-bundled) — nothing absolute to fetch.
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (PRIVATE_HOST_RE.test(url.hostname)) return null;
  return url;
}

/** Content-Type is not always honest (R2 serves octet-stream for some
 *  uploads), so fall back to the file signature before giving up on an image
 *  that would have decoded fine. */
function sniffMime(b: Uint8Array): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
    return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return "image/webp";
  return null;
}

/**
 * sharp, if this deployment has it.
 *
 * NOT a new dependency: sharp is an optionalDependency of `next` itself (it is
 * what `/_next/image` uses), it is installed by `npm ci`, and self-hosted
 * standalone builds trace it into the runtime bundle — Next only excludes it
 * when deploying on Vercel, which we don't. `@vercel/og` reaches for it the
 * same way, in the same try/catch, for its own SVG rasterising.
 *
 * Because it is *optional*, nothing here may require it: if the import fails,
 * a webp image is simply dropped from the card and the layout carries on
 * (monogram instead of a logo, text-only product card). Resolved once per
 * process.
 */
let sharpModule: Promise<SharpFactory | null> | null = null;

/** Minimal structural type — sharp ships its own, but typing against them
 *  would make an optional package a compile-time requirement. */
interface SharpImage {
  rotate(): SharpImage;
  resize(opts: { width: number; withoutEnlargement: boolean }): SharpImage;
  png(opts: {
    compressionLevel: number;
    palette?: boolean;
    quality?: number;
    effort?: number;
  }): SharpImage;
  toBuffer(): Promise<Buffer>;
}
type SharpFactory = (input: Buffer) => SharpImage;

function loadSharp(): Promise<SharpFactory | null> {
  if (!sharpModule) {
    sharpModule = import("sharp")
      .then((m) => (m.default ?? m) as unknown as SharpFactory)
      .catch(() => null);
  }
  return sharpModule;
}

/**
 * Make bytes satori can draw: transcode webp/avif to PNG, and downscale
 * anything oversized. Returns null only when the image is unusable AND cannot
 * be converted — a satori-native image that merely failed to shrink is passed
 * through untouched.
 */
async function normalizeForSatori(
  bytes: Uint8Array,
  mime: string,
  maxWidth: number,
): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const mustTranscode = !SATORI_MIME.has(mime);
  if (!mustTranscode && bytes.byteLength <= NORMALIZE_ABOVE_BYTES) {
    return { bytes, mime };
  }
  const sharp = await loadSharp();
  if (!sharp) return mustTranscode ? null : { bytes, mime };
  try {
    const out = await sharp(Buffer.from(bytes))
      // Bare .rotate() applies EXIF orientation — merchant product photos come
      // straight off phones and would otherwise land sideways on the card.
      .rotate()
      .resize({ width: maxWidth, withoutEnlargement: true })
      .png({ compressionLevel: 6 })
      .toBuffer();
    return { bytes: new Uint8Array(out), mime: "image/png" };
  } catch {
    return mustTranscode ? null : { bytes, mime };
  }
}

/**
 * Fetch a remote image and inline it as a data URI satori can render.
 *
 * satori can fetch `src` URLs itself, but then a slow or 404ing merchant CDN
 * becomes an unbounded, unhandled failure inside the render. Doing it here
 * gives us a timeout, a size cap, a format we know it can decode and — most
 * importantly — a `null` we can render around, so a dead image URL costs the
 * photo, not the card.
 *
 * `cache: "no-store"` keeps multi-megabyte binaries out of Next's data cache
 * (which warns and drops anything over 2MB anyway); the CDN caches the
 * finished PNG instead, via the Cache-Control this route sets.
 *
 * @param maxWidth the widest this image is ever drawn on the card
 */
export async function fetchCardImage(
  rawUrl: string | null | undefined,
  maxWidth = 1120,
): Promise<string | null> {
  const url = safeImageUrl(rawUrl);
  if (!url) return null;

  try {
    const res = await fetch(url, {
      cache: "no-store",
      redirect: "follow",
      headers: { accept: "image/*" },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_IMAGE_BYTES) return null;

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return null;

    const headerMime = (res.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const mime = FETCHABLE_MIME.has(headerMime) ? headerMime : sniffMime(bytes);
    if (!mime) return null;

    const usable = await normalizeForSatori(bytes, mime, maxWidth);
    if (!usable) return null;
    return `data:${usable.mime};base64,${Buffer.from(usable.bytes).toString("base64")}`;
  } catch {
    // Timeout / DNS / TLS / abort — the card renders without the image.
    return null;
  }
}

// ── Cards ───────────────────────────────────────────────────────────────────

interface StoreCardProps {
  /** Already latinSafe + clamped by the route. */
  name: string;
  description: string;
  /** Display host, e.g. `vionne.numueg.app`. */
  host: string;
  logo: string | null;
}

/** Thin saffron rail across the top — the one piece of NUMU chrome both cards
 *  share, so a generated card is recognisable at thumbnail size. */
function TopRail() {
  return (
    <div
      style={{
        display: "flex",
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: 12,
        backgroundColor: BRAND.saffron,
      }}
    />
  );
}

export function StoreOgCard({ name, description, host, logo }: StoreCardProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        position: "relative",
        backgroundColor: BRAND.navy,
        backgroundImage: `linear-gradient(135deg, ${BRAND.navy} 0%, ${BRAND.navy700} 100%)`,
        color: BRAND.paper,
      }}
    >
      <TopRail />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
          padding: "0 88px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 148,
              height: 148,
              borderRadius: 32,
              backgroundColor: BRAND.paper,
              overflow: "hidden",
            }}
          >
            {logo ? (
              <img
                src={logo}
                width={128}
                height={128}
                style={{ objectFit: "contain" }}
                alt=""
              />
            ) : (
              <div style={{ display: "flex", fontSize: 76, color: BRAND.navy }}>
                {monogram(name, host)}
              </div>
            )}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              marginLeft: 40,
              maxWidth: 780,
            }}
          >
            <div style={{ display: "flex", fontSize: 66, lineHeight: 1.1 }}>
              {name}
            </div>
          </div>
        </div>
        {description ? (
          <div
            style={{
              display: "flex",
              marginTop: 40,
              maxWidth: 940,
              fontSize: 30,
              lineHeight: 1.45,
              color: BRAND.paperSoft,
            }}
          >
            {description}
          </div>
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "0 88px 64px",
        }}
      >
        <div
          style={{
            display: "flex",
            width: 14,
            height: 14,
            borderRadius: 7,
            backgroundColor: BRAND.saffron,
          }}
        />
        <div
          style={{
            display: "flex",
            marginLeft: 18,
            fontSize: 28,
            letterSpacing: 2,
            color: BRAND.saffron,
          }}
        >
          {host}
        </div>
      </div>
    </div>
  );
}

interface ProductCardProps {
  /** Already latinSafe + clamped by the route. */
  productName: string;
  storeName: string;
  price: string;
  compareAt: string | null;
  host: string;
  image: string | null;
}

const PRODUCT_IMAGE_WIDTH = 560;

export function ProductOgCard({
  productName,
  storeName,
  price,
  compareAt,
  host,
  image,
}: ProductCardProps) {
  return (
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        position: "relative",
        backgroundColor: BRAND.navy,
        color: BRAND.paper,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: PRODUCT_IMAGE_WIDTH,
          height: "100%",
          backgroundColor: BRAND.cream,
          overflow: "hidden",
        }}
      >
        {image ? (
          <img
            src={image}
            width={PRODUCT_IMAGE_WIDTH}
            height={OG_SIZE.height}
            style={{ objectFit: "cover" }}
            alt=""
          />
        ) : (
          <div style={{ display: "flex", fontSize: 180, color: BRAND.navy }}>
            {monogram(storeName, host)}
          </div>
        )}
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "space-between",
          padding: "68px 56px 64px",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column" }}>
          {storeName ? (
            <div
              style={{
                display: "flex",
                fontSize: 24,
                letterSpacing: 3,
                color: BRAND.saffron,
              }}
            >
              {storeName.toUpperCase()}
            </div>
          ) : null}
          {productName ? (
            <div
              style={{
                display: "flex",
                marginTop: 22,
                fontSize: 48,
                lineHeight: 1.18,
              }}
            >
              {productName}
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* `whiteSpace: nowrap` because Intl separates the currency from the
              amount with a NO-BREAK space and satori breaks the line there
              anyway — "EGP" on one line and "230.00" on the next reads like a
              rendering bug on the one element shoppers actually scan for. */}
          <div style={{ display: "flex", alignItems: "flex-end" }}>
            <div
              style={{
                display: "flex",
                fontSize: 48,
                color: BRAND.paper,
                whiteSpace: "nowrap",
              }}
            >
              {price}
            </div>
            {compareAt ? (
              <div
                style={{
                  display: "flex",
                  marginLeft: 18,
                  paddingBottom: 7,
                  fontSize: 28,
                  color: BRAND.paperSoft,
                  whiteSpace: "nowrap",
                  textDecoration: "line-through",
                }}
              >
                {compareAt}
              </div>
            ) : null}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 26,
              fontSize: 24,
              letterSpacing: 2,
              color: BRAND.saffron,
            }}
          >
            {host}
          </div>
        </div>
      </div>
      <TopRail />
    </div>
  );
}

/**
 * Last-resort card: brand chrome plus one line of already-sanitised text, no
 * remote images, no measured layout to get wrong. If the real card throws,
 * this is what a shopper sees instead of a broken preview.
 */
function FallbackOgCard({ title }: { title: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        position: "relative",
        backgroundColor: BRAND.navy,
        color: BRAND.paper,
      }}
    >
      <TopRail />
      <div style={{ display: "flex", fontSize: 64, textAlign: "center" }}>
        {title}
      </div>
    </div>
  );
}

/** 1×1 transparent PNG — the floor. Reached only if satori itself is broken
 *  (missing wasm, OOM), where the alternative would be a 500 on a share. */
const BLANK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * Shared cache policy. Deliberately NOT `immutable`: the card URL is stable
 * (Next hashes the route file, not the store data), so an immutable year would
 * pin a stale card forever after a rename, a new logo or a price change.
 */
const CARD_CACHE_CONTROL =
  "public, max-age=3600, stale-while-revalidate=86400";

/**
 * Render a card to a fully-buffered PNG response.
 *
 * Buffering is the point — see note 5 in the header. `ImageResponse` hands back
 * a Response whose body is rendered lazily, so we drain it here to convert a
 * mid-stream satori throw into a plain rejection we can fall back from.
 */
export async function renderOgCard(
  card: ReactElement,
  fallbackTitle: string,
): Promise<Response> {
  try {
    return await bufferCard(card);
  } catch (err) {
    console.error("[opengraph-image] card render failed", err);
  }
  try {
    return await bufferCard(<FallbackOgCard title={fallbackTitle || "NUMU"} />);
  } catch (err) {
    console.error("[opengraph-image] fallback card failed", err);
    return new Response(BLANK_PNG, {
      headers: {
        "content-type": OG_CONTENT_TYPE,
        "cache-control": "public, max-age=60",
      },
    });
  }
}

/**
 * Past this, spend ~250ms quantising the PNG. WhatsApp is the channel this
 * feature exists for and it is the least forgiving about preview weight — a
 * card with a real product photo comes out of resvg at ~830KB as truecolour
 * PNG, which is heavy enough to risk the preview being skipped. Palette
 * quantisation takes the same card to ~230KB with no visible difference at
 * share size. Below the threshold (text-only cards are ~25KB) it is not worth
 * the CPU.
 */
const QUANTISE_ABOVE_BYTES = 300 * 1024;

async function bufferCard(card: ReactElement): Promise<Response> {
  const rendered = new ImageResponse(card, {
    width: OG_SIZE.width,
    height: OG_SIZE.height,
  });
  const body = await rendered.arrayBuffer();
  const out = await shrinkPng(body);
  return new Response(out, {
    headers: {
      "content-type": OG_CONTENT_TYPE,
      "content-length": String(out.byteLength),
      "cache-control": CARD_CACHE_CONTROL,
    },
  });
}

/** Optional, like every other use of sharp here: no sharp, no libimagequant,
 *  or a bigger result → the original bytes go out unchanged. */
async function shrinkPng(png: ArrayBuffer): Promise<ArrayBuffer> {
  if (png.byteLength <= QUANTISE_ABOVE_BYTES) return png;
  const sharp = await loadSharp();
  if (!sharp) return png;
  try {
    const out = await sharp(Buffer.from(png))
      .png({ compressionLevel: 9, palette: true, quality: 80, effort: 7 })
      .toBuffer();
    if (out.byteLength >= png.byteLength) return png;
    // Copy into a standalone ArrayBuffer: sharp hands back a pooled Buffer
    // view, whose backing store is wider than these bytes.
    return new Uint8Array(out).buffer;
  } catch {
    return png;
  }
}
