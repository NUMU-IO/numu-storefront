/**
 * Which storefront URL OWNS a content handle that is reachable twice.
 *
 * A handle like `about` answers 200 at TWO paths: `/about` (the `[...slug]`
 * catch-all, which renders the theme's designed `about` template) and
 * `/pages/about` (the plainer CMS route). Same subject, two indexable URLs —
 * so one of them has to declare itself the original, or Google picks. It picked
 * the plainer one, because the catch-all was blanket-`noindex`ed while
 * `/pages/{handle}` said `index, follow`.
 *
 * `/{handle}` is the original: it renders the theme's designed page and is what
 * the theme's own nav links to. This module is the ONE place that decision is
 * made — the catch-all's self-canonical and `/pages/{handle}`'s cross-canonical
 * read the same predicate, so they cannot disagree about which URL is the
 * duplicate (two self-canonicals on identical content is exactly the split this
 * fixes).
 */
import type { ThemeSettingsV3 } from "@/types";

/**
 * Standard storefront content pages that themes link to from their default
 * nav/footer. A path whose first segment is one of these renders a themed PAGE
 * (HTTP 200) at `/{handle}` — the theme's template or the CMS body when either
 * exists, otherwise a placeholder that stays out of the index. ANY other
 * unmatched path is genuinely missing → the theme's 404 template with a real
 * HTTP 404 status (no soft-404 at 200), which is also why `/pages/{handle}`
 * must NOT canonicalise to a handle absent from this list: that URL 404s.
 */
export const KNOWN_PAGE_HANDLES: ReadonlySet<string> = new Set([
  "about", "about-us", "our-story", "story",
  "contact", "contact-us",
  "shipping", "shipping-policy", "delivery", "delivery-policy",
  "returns", "returns-policy", "refund-policy", "refunds", "exchanges",
  "faq", "faqs",
  // Deliberately NOT "track"/"track-order"/"order-tracking": /track is a real
  // route now (`[domain]/track` — the guest order-lookup form). While "track"
  // sat in this list, the "Track order" link in every theme footer answered 200
  // with header + a lone "Track" heading + footer, because the synthesized page
  // carries no body — the exact dead end this allowlist exists to prevent. The
  // two unrouted variants 404 honestly instead of repeating it.
  "terms", "terms-of-service", "terms-and-conditions", "terms-conditions",
  "privacy", "privacy-policy",
  "size-guide", "sizing", "size-chart",
  "lookbook",
  "stores", "locations", "store-locator", "our-stores",
  "wholesale",
  "careers",
  "gift-cards", "gift-card",
  "testimonial", "testimonials", "reviews",
  "blogs", "blog", "news", "journal",
  "pages",
  // Account + post-purchase pages a theme templates (bazar ships profile +
  // order-confirmation) and links to from chrome — without these they fall to
  // notFound() and the customer/merchant sees the themed 404.
  "profile", "account",
  "order-confirmation", "order-confirmed", "thank-you", "thanks",
]);

/**
 * Catch-all handles that map onto a DEDICATED theme template type rather than
 * the generic `page` template — so a theme shipping an About/Contact design
 * (bazar's bz-about-section, vionne's `about` + `contact`) renders it instead
 * of an empty page body. Keys are a subset of KNOWN_PAGE_HANDLES; a handle
 * absent here stays `page`, and a theme without the mapped template still
 * degrades to the route fallback, so this is purely additive.
 */
export const TEMPLATE_TYPE_BY_HANDLE: Record<string, string> = {
  about: "about",
  "about-us": "about",
  "our-story": "about",
  story: "about",
  contact: "contact",
  "contact-us": "contact",
  // Account → the theme's `profile` template; post-purchase → its
  // `order-confirmation` template.
  profile: "profile",
  account: "profile",
  "order-confirmation": "order-confirmation",
  "order-confirmed": "order-confirmation",
  "thank-you": "order-confirmation",
  thanks: "order-confirmation",
};

/**
 * Handles that stay out of the index no matter what content resolves for them.
 *
 * These carry a template in most themes' presets (vionne declares `profile`,
 * `account` and `order-confirmation`), so a rule that indexed "any handle the
 * theme templates" would publish the logged-in customer surface and the
 * post-purchase confirmation — the latter reached with a real `?order_id=` in
 * the URL — straight into search results.
 */
export const NEVER_INDEXED_HANDLES: ReadonlySet<string> = new Set([
  "profile",
  "account",
  "order-confirmation",
  "order-confirmed",
  "thank-you",
  "thanks",
]);

/**
 * True when `/{handle}` — the catch-all — is the URL that owns this content:
 * it renders something real AND is the form the theme's nav links to, so it
 * both self-canonicalises and receives `/pages/{handle}`'s canonical.
 *
 * False means the catch-all shows a body-less placeholder (or 404s outright),
 * so `/{handle}` must stay `noindex` with no canonical of its own and
 * `/pages/{handle}` keeps its normal self-canonical.
 *
 * @param handle single-segment content handle, e.g. `about`
 * @param _themeSettings retained for callers; a template alone no longer grants
 *   ownership (see below)
 * @param hasCmsBody a PUBLISHED CMS page with a non-empty body backs the handle
 */
export function catchAllOwnsHandle(
  handle: string,
  _themeSettings: ThemeSettingsV3 | null | undefined,
  hasCmsBody: boolean,
): boolean {
  const key = handle.toLowerCase();
  // Nested paths (`about/team`) re-render the SAME template as their parent —
  // never a distinct document, so never a canonical target.
  if (!key || key.includes("/")) return false;
  if (NEVER_INDEXED_HANDLES.has(key)) return false;
  // `/{handle}` 404s outside the allowlist, so it can't own anything.
  if (!KNOWN_PAGE_HANDLES.has(key)) return false;
  if (hasCmsBody) return true;
  // A dedicated theme template is NOT enough on its own. BYOT themes paint
  // client-side, so with no CMS body the initial HTML a crawler reads has no
  // h1 and no copy — `/about` and `/contact` were emitting `index, follow` for
  // exactly that (measured live: h1=0, 2 anchors, 0 JSON-LD). Without a body
  // they now behave like `/shipping` and `/faq`: noindex+follow here, and
  // `/pages/{handle}` keeps its own self-canonical. Publishing a CMS body
  // flips the handle back to indexable.
  return false;
}
