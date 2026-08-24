/**
 * Client-side traffic-source derivation.
 *
 * Mirror of the API's `src/application/services/traffic_source.py`. The two
 * tables MUST agree: this one names the visit on the abandoned-checkout
 * write, that one names it on the funnel rows and the order, and a cart
 * that becomes an order would otherwise be reported under two different
 * sources.
 *
 * Chain — first rung that resolves wins:
 *
 *   1. An explicit `utm_source` (handled by the caller — merchant intent
 *      always beats inference).
 *   2. An ad-platform click id (ttclid / fbclid / gclid) -> medium "paid".
 *   3. The in-app browser's User-Agent -> medium "social".
 *   4. The referrer host -> medium "organic" | "social" | "referral".
 *
 * The User-Agent outranks the referrer, which is the opposite of the usual
 * analytics convention, because an in-app browser is unambiguous proof of
 * the app the visitor came from while a referrer is often an intermediary:
 * a TikTok bio link routed through linktr.ee reports linktr.ee, which is
 * true but useless to a merchant asking whether TikTok worked.
 *
 * Both rungs are needed because the platforms differ in what they send.
 * Instagram's shim sends a referrer (`l.instagram.com`); TikTok's webview
 * sends none at all, so rung 3 is the only thing that can see it.
 */

export const MEDIUM_PAID = "paid";
export const MEDIUM_SOCIAL = "social";
export const MEDIUM_ORGANIC = "organic";
export const MEDIUM_REFERRAL = "referral";
export const MEDIUM_EMAIL = "email";

/**
 * In-app browser User-Agent markers, lowercased. Order is priority: a
 * webview can carry more than one vendor token (Instagram's embeds Meta's
 * `FBAV`), so the more specific app is listed first.
 */
const IN_APP_BROWSER_SOURCES: ReadonlyArray<readonly [string, string]> = [
  // TikTok ships its webview under several build names — `musical_ly` and
  // `aweme` are the app's original and CN bundle ids and still appear in
  // the wild alongside `BytedanceWebview`.
  ["bytedancewebview", "tiktok"],
  ["bytelocwebview", "tiktok"],
  ["musical_ly", "tiktok"],
  ["aweme", "tiktok"],
  ["tiktok", "tiktok"],
  // Instagram before the Meta tokens: its webview reports BOTH.
  ["instagram", "instagram"],
  ["fb_iab", "facebook"],
  ["fban", "facebook"],
  ["fbav", "facebook"],
  ["snapchat", "snapchat"],
  ["pinterest", "pinterest"],
  ["linkedinapp", "linkedin"],
];

/**
 * Referrer host suffix -> [source, medium]. Matched against the parsed
 * host, so `l.instagram.com` resolves through the `instagram.com` entry.
 * An allowlist by construction: an unrecognised host — including the
 * store's own domain on internal navigation — derives nothing.
 */
const REFERRER_SOURCES: ReadonlyArray<readonly [string, string, string]> = [
  // Exact android-app netloc, before the Google pattern below would claim
  // it: mail is not search traffic.
  ["com.google.android.gm", "gmail", MEDIUM_EMAIL],
  ["tiktok.com", "tiktok", MEDIUM_SOCIAL],
  ["instagram.com", "instagram", MEDIUM_SOCIAL],
  ["facebook.com", "facebook", MEDIUM_SOCIAL],
  ["messenger.com", "messenger", MEDIUM_SOCIAL],
  ["whatsapp.com", "whatsapp", MEDIUM_SOCIAL],
  ["snapchat.com", "snapchat", MEDIUM_SOCIAL],
  ["pinterest.com", "pinterest", MEDIUM_SOCIAL],
  ["linkedin.com", "linkedin", MEDIUM_SOCIAL],
  ["youtube.com", "youtube", MEDIUM_SOCIAL],
  ["twitter.com", "twitter", MEDIUM_SOCIAL],
  ["x.com", "twitter", MEDIUM_SOCIAL],
  ["t.co", "twitter", MEDIUM_SOCIAL],
  ["bing.com", "bing", MEDIUM_ORGANIC],
  ["yahoo.com", "yahoo", MEDIUM_ORGANIC],
  ["duckduckgo.com", "duckduckgo", MEDIUM_ORGANIC],
  ["linktr.ee", "linktree", MEDIUM_REFERRAL],
  ["beacons.ai", "beacons", MEDIUM_REFERRAL],
  ["chatgpt.com", "chatgpt", MEDIUM_REFERRAL],
  ["perplexity.ai", "perplexity", MEDIUM_REFERRAL],
];

// Google's ccTLDs are unbounded (google.com, google.com.eg, google.co.uk),
// so they get a pattern rather than table rows.
const GOOGLE_HOST = /(?:^|\.)google\.[a-z]{2,}(?:\.[a-z]{2,})?$/;

export interface DerivedSource {
  source: string;
  medium: string;
}

export function deriveSourceFromUserAgent(
  userAgent: string | null | undefined,
): DerivedSource | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  for (const [marker, source] of IN_APP_BROWSER_SOURCES) {
    if (ua.includes(marker)) return { source, medium: MEDIUM_SOCIAL };
  }
  return null;
}

export function deriveSourceFromReferrer(
  referrer: string | null | undefined,
): DerivedSource | null {
  if (!referrer) return null;
  let raw = referrer.trim();
  if (!raw) return null;
  // A bare host with no scheme parses as a path, not a hostname.
  if (!raw.includes("//")) raw = `//${raw}`;

  let host: string;
  try {
    // `URL` needs an absolute base for protocol-relative input.
    host = new URL(raw, "https://placeholder.invalid").hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host || host === "placeholder.invalid") return null;

  for (const [suffix, source, medium] of REFERRER_SOURCES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) {
      return { source, medium };
    }
  }
  if (GOOGLE_HOST.test(host)) {
    return { source: "google", medium: MEDIUM_ORGANIC };
  }
  return null;
}

/**
 * Rungs 3 and 4 only. The click-id rung lives in `cart-track-attribution.ts`
 * because it reads the attribution envelope rather than the environment.
 *
 * Reads `navigator` / `document` when the caller passes nothing, so it is
 * a no-op during SSR.
 */
export function deriveSourceFromEnvironment(args?: {
  userAgent?: string | null;
  referrer?: string | null;
}): DerivedSource | null {
  const userAgent =
    args?.userAgent ??
    (typeof navigator !== "undefined" ? navigator.userAgent : null);
  const referrer =
    args?.referrer ??
    (typeof document !== "undefined" ? document.referrer : null);

  return (
    deriveSourceFromUserAgent(userAgent) ?? deriveSourceFromReferrer(referrer)
  );
}
