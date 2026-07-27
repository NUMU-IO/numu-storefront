"use client";

/**
 * Single mount point for the host-rendered promo overlays (popup, floating
 * widget, cookie banner) — rendered in [domain]/layout.tsx after the
 * announcement bar so the overlays sit above every page. Each surface picks
 * the highest-priority active promotion (server-sorted) and self-manages its
 * own trigger + dismissal.
 */

import { useParams, usePathname } from "next/navigation";
import type { ResolvedPromotion } from "@/lib/promo-server";
import { PopupModal, popupOpensAtFirstPaint } from "./PopupModal";
import { FloatingWidget } from "./FloatingWidget";
import { CookieBanner } from "./CookieBanner";

/**
 * Routes where a popup that opens at first paint is suppressed.
 *
 * PopupModal draws a `fixed inset-0` overlay with a full-viewport backdrop, so
 * on these routes it does not just distract — it physically blocks the page: a
 * browser run on /search could not reach the search input at all ("subtree
 * intercepts pointer events") until the popup was dismissed, which reads to the
 * shopper as "this store has no working search". /track is worse still: the
 * lookup form is the entire page, so the overlay covers the only control there
 * is.
 *
 * A visitor here has already declared intent — typed a query, is chasing a
 * parcel, is holding a cart, is paying, is managing their account — and an
 * interstitial thrown in their face at first paint is pure friction. Browse
 * routes (home, PLP, PDP, collections) are exactly where a popup belongs and
 * are deliberately untouched.
 *
 * Only the immediate open is dropped. A merchant who wired on_exit_intent /
 * on_scroll_pct / on_delay chose an intent-driven moment (exit-intent recovery
 * on checkout is a legitimate abandonment play), so those still fire.
 */
const NO_IMMEDIATE_POPUP_ROUTES = [
  "/search",
  "/track",
  "/cart",
  "/checkout",
  "/account",
];

/** Mirrors proxy.ts `isLocalePrefix`: a bare two-letter ISO 639-1 code. */
const LOCALE_SEGMENT_RE = /^[a-z]{2}$/;

/**
 * The route the visitor is on, stripped of the two prefixes that ride in front
 * of it, so one URL yields one route string in every mode it can be served
 * under. Both prefixes were silently defeating the comparison below.
 *
 *  1. `/<domain>` — production serves each store on its own subdomain, where
 *     `usePathname()` is `/track`; dev path-segment routing puts the store
 *     first, where it is `/testlocal/track`. Normalising against the `domain`
 *     route param reconciles them.
 *  2. `/<locale>` — proxy.ts strips a leading locale code BEFORE it rewrites
 *     to `/<domain>/…`, so the server never sees it, but the browser URL keeps
 *     it and `usePathname()` reports the browser URL: on `/ar/track` it
 *     returns `/ar/track`, which matches nothing in the list. That is not an
 *     edge case here — Arabic is the default for Egyptian traffic, so the
 *     locale-prefixed URL is the common one.
 *
 * Over-stripping is bounded: every real first segment in this app is three or
 * more characters, so the only two-letter segment that can be eaten is a CMS
 * page handle, and that lands on `/` — a browse route, where a popup is
 * allowed regardless.
 */
function normalizeRoute(
  pathname: string | null,
  domain: string | null,
): string {
  let path = (pathname || "/").toLowerCase();
  if (domain) {
    const prefix = `/${domain.toLowerCase()}`;
    if (path === prefix) path = "/";
    else if (path.startsWith(`${prefix}/`)) path = path.slice(prefix.length);
  }
  // After the domain, so the rewritten `/<domain>/ar/track` shape normalises
  // too — proxy.ts orders the strips the other way round, but a request that
  // reaches the app already prefixed (path-segment mode, editor preview) does
  // not go through that branch.
  const firstSegment = path.split("/")[1] || "";
  if (LOCALE_SEGMENT_RE.test(firstSegment)) {
    path = path.slice(`/${firstSegment}`.length) || "/";
  }
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function blocksImmediatePopup(route: string): boolean {
  return NO_IMMEDIATE_POPUP_ROUTES.some(
    (r) => route === r || route.startsWith(`${r}/`),
  );
}

export function PromoMounts({
  popups,
  floatingWidgets,
  cookieBanner,
  locale = "ar",
  brandVars,
}: {
  popups: ResolvedPromotion[];
  floatingWidgets: ResolvedPromotion[];
  cookieBanner: ResolvedPromotion | null;
  locale?: string;
  /** `--ck-*` brand tokens (from the active theme) for the cookie banner. */
  brandVars?: Record<string, string>;
}) {
  const params = useParams();
  const pathname = usePathname();
  const route = normalizeRoute(
    pathname,
    typeof params?.domain === "string" ? params.domain : null,
  );

  const popup = popups?.[0] ?? null;
  const widget = floatingWidgets?.[0] ?? null;
  // Whether this popup lands at first paint is PopupModal's call, not ours —
  // see popupOpensAtFirstPaint for why asking it here rather than testing the
  // trigger string locally is what makes the list above bite.
  const popupTrigger = (popup?.display as { trigger?: string } | undefined)
    ?.trigger;
  const showPopup =
    !!popup &&
    !(popupOpensAtFirstPaint(popupTrigger) && blocksImmediatePopup(route));
  return (
    <>
      {cookieBanner && (
        <CookieBanner
          promotion={cookieBanner}
          locale={locale}
          brandVars={brandVars}
        />
      )}
      {widget && (
        <FloatingWidget
          promotion={widget}
          popupCount={popups?.length || 0}
          locale={locale}
        />
      )}
      {showPopup && popup && <PopupModal promotion={popup} locale={locale} />}
    </>
  );
}
