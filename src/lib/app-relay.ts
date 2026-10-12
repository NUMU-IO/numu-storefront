/**
 * The same-origin relay for apps' shopper routes (APP-STANDARD § 4.4).
 *
 * `/api/apps/<slug>/<path>` on a store host → NUMU-api
 * `/storefront/store/<store id>/apps/<slug>/<path>`, with the internal-service
 * headers so the API rate-limits per shopper rather than per storefront
 * server. The route (`app/api/apps/[slug]/[...path]/route.ts`) and the shared
 * unsubscribe page both build the upstream path here, so neither can be
 * talked into another API path.
 */

/** Apps with shopper routes. A new app adds its slug here. */
export const RELAY_APPS: ReadonlySet<string> = new Set(["back-in-stock"]);

/** Route names and `token_urlsafe` tokens only: no dots, slashes or escapes. */
const SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

/** The NUMU-api path to relay to, or null when the relay must refuse. */
export function relayPath(storeId: string, slug: string, path: string[]): string | null {
  if (!RELAY_APPS.has(slug) || path.length === 0 || !path.every((p) => SEGMENT.test(p))) {
    return null;
  }
  return `/storefront/store/${storeId}/apps/${slug}/${path.join("/")}`;
}

/** The body a mail client sends for a one-click unsubscribe (RFC 8058). */
const ONE_CLICK = "List-Unsubscribe=One-Click";

/**
 * Where to send a browser after the shared unsubscribe page's form posted
 * (it works without script, so it is a plain form POST, not the SDK's JSON):
 * back to the page, which then says it is done. Null for everything else —
 * the SDK's calls and a mail client's one-click POST get the API's answer.
 */
export function formReturnTo(
  slug: string,
  path: string[],
  contentType: string | null,
  body: string,
  ok: boolean,
): string | null {
  const [route, token] = path;
  if (route !== "unsubscribe" || path.length !== 2) return null;
  if (!(contentType ?? "").startsWith("application/x-www-form-urlencoded")) return null;
  if (body.includes(ONE_CLICK)) return null;
  return `/unsubscribe/${slug}/${token}${ok ? "?done=1" : ""}`;
}
