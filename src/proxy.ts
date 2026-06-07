import { NextRequest, NextResponse } from "next/server";

const PLATFORM_DOMAIN = process.env.NUMU_PLATFORM_DOMAIN || "numueg.app";

// Subdomain segments that come AFTER the [domain] in path routing.
// When the proxy sees one of these as the first path segment, it
// implies the request is missing its subdomain prefix and we need to
// rebase under whichever subdomain we can recover from Referer/cookie.
const POST_DOMAIN_SEGMENTS = new Set([
  "collections",
  "products",
  "cart",
  "checkout",
  "account",
  "search",
  "pages",
  "blogs",
  "policies",
  "password",
]);

// Phase 6 — locale URL prefixes. We accept any 2-character ISO 639-1
// code in the first path segment; the SSR layer validates against the
// store's actual locale list and falls back to default_language for
// unknown codes. Two letters is the common shape today (`/ar/...`,
// `/en/...`); regional sub-tags (`/zh-tw/...`) can ride the same
// matcher if we extend to 2-5 chars later. We intentionally do NOT
// hard-code a whitelist — themes / merchants may add locales over
// time, and the SSR handles the fallback gracefully.
const LOCALE_PREFIX_RE = /^[a-z]{2}$/i;

function isLocalePrefix(segment: string): boolean {
  if (!segment) return false;
  if (!LOCALE_PREFIX_RE.test(segment)) return false;
  // Defensive: a 2-char segment that happens to also be a known
  // post-domain route shouldn't be treated as a locale prefix.
  // No current 2-letter routes exist, but this keeps the matcher
  // safe if we ever add one.
  return !POST_DOMAIN_SEGMENTS.has(segment.toLowerCase());
}

function subdomainFromReferer(request: NextRequest): string | null {
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    const refUrl = new URL(referer);
    const refSeg = refUrl.pathname.split("/")[1];
    if (refSeg && !POST_DOMAIN_SEGMENTS.has(refSeg)) return refSeg;
  } catch {
    /* malformed Referer */
  }
  return null;
}

function subdomainFromCookie(request: NextRequest): string | null {
  const value = request.cookies.get("numu_active_store")?.value;
  if (!value) return null;
  // Cookie holds the subdomain string (`lumiere`, `mystore`, etc.). We
  // don't trust this value beyond using it as a routing hint — the
  // [domain]/layout.tsx still validates the subdomain server-side via
  // fetchStoreByDomain.
  if (!/^[a-z0-9-]+$/i.test(value)) return null;
  if (POST_DOMAIN_SEGMENTS.has(value.toLowerCase())) return null;
  return value;
}

// Next 16 renamed the file convention from `middleware.ts` to `proxy.ts`
// and the export from `middleware` to `proxy`. Behavior is identical.
export function proxy(request: NextRequest) {
  const rawHost = (request.headers.get("host") || "").toLowerCase();
  // Strip the port — `numu.localhost:3000` should match the same rules
  // as `numu.numueg.app`. Leaving the port in breaks every endsWith()
  // comparison below.
  const hostname = rawHost.split(":")[0];
  const pathname = request.nextUrl.pathname;

  // Client API calls (cart add/get, etc.) resolve the store from the
  // `x-numu-host` header. The backend reduces it via removesuffix(".numueg.app"),
  // so a DEEP platform host like `<store>.v3.test.numueg.app` would resolve to
  // `<store>.v3.test` → no store → 400 ("Unable to identify store for guest
  // cart"). Inject the apex-form host (`<store>.numueg.app`) so the backend
  // extracts `<store>` correctly. On the 1-level bazaar host
  // (PLATFORM_DOMAIN=numueg.app) this branch is a no-op.
  if (pathname.startsWith("/api/")) {
    if (
      PLATFORM_DOMAIN !== "numueg.app" &&
      hostname.endsWith(`.${PLATFORM_DOMAIN}`)
    ) {
      const sub = hostname.slice(0, -(PLATFORM_DOMAIN.length + 1));
      const requestHeaders = new Headers(request.headers);
      requestHeaders.set("x-numu-host", `${sub}.numueg.app`);
      return NextResponse.next({ request: { headers: requestHeaders } });
    }
    return NextResponse.next();
  }

  // Skip static assets.
  if (pathname.startsWith("/_next/") || pathname.includes(".")) {
    return NextResponse.next();
  }

  // Hostname shapes:
  //  - `numueg.app` / `localhost`           — apex; pass through
  //  - `<sub>.numueg.app` / `<sub>.localhost` — subdomain store
  //  - anything else                         — custom domain
  //
  // `*.localhost` is supported in dev because modern browsers resolve it
  // to 127.0.0.1 automatically (no hosts-file edit needed). Treat it as
  // a subdomain pattern in addition to whatever PLATFORM_DOMAIN is set to.

  // Apex passthrough.
  if (
    hostname === PLATFORM_DOMAIN ||
    hostname === `www.${PLATFORM_DOMAIN}` ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  ) {
    // Dev path-segment routing: themes naturally render absolute paths
    // like `/collections/all` (matches the prod subdomain root). On
    // apex localhost those land at `/collections/all`, miss the
    // [domain] route, and 404. We rebase under the right `<subdomain>`
    // using two signals, in order of preference:
    //
    //   1. Referer header — present on most in-app navigations.
    //   2. `numu_active_store` cookie — set by [domain]/layout.tsx
    //      on every store render. Covers deep links opened in a new
    //      tab, cross-origin Referers (e.g. iframe parents), and
    //      privacy-mode browsers that strip Referer.
    //
    // Production never hits this branch — subdomain hostnames route
    // via the hostname check above.
    const firstSeg = pathname.split("/")[1] || "";
    if (POST_DOMAIN_SEGMENTS.has(firstSeg)) {
      const subdomain =
        subdomainFromReferer(request) || subdomainFromCookie(request);
      if (subdomain) {
        const url = request.nextUrl.clone();
        url.pathname = `/${subdomain}${pathname}`;
        return NextResponse.rewrite(url);
      }
    }
    return NextResponse.next();
  }

  let storeIdentifier: string | null = null;

  if (hostname.endsWith(`.${PLATFORM_DOMAIN}`)) {
    storeIdentifier = hostname.slice(0, -(PLATFORM_DOMAIN.length + 1));
  } else if (hostname.endsWith(".localhost")) {
    // Dev convenience: `<sub>.localhost` always treated as a subdomain.
    storeIdentifier = hostname.slice(0, -".localhost".length);
  } else if (hostname) {
    storeIdentifier = hostname;
  }

  if (storeIdentifier) {
    // Self-correct the "double subdomain" case: a request to
    // `lumiere.localhost:3000/lumiere/...` (the subdomain repeated as
    // the first path segment) would naively rewrite to
    // `/lumiere/lumiere/...` and 404. This typically happens when a
    // hub button or dev link mistakenly includes `/<subdomain>` on a
    // URL that already has the subdomain in the host. Redirect to the
    // root once and let the user share clean links.
    const firstSeg = pathname.split("/")[1] || "";
    if (firstSeg.toLowerCase() === storeIdentifier.toLowerCase()) {
      const fixed = request.nextUrl.clone();
      fixed.pathname = pathname.slice(`/${firstSeg}`.length) || "/";
      return NextResponse.redirect(fixed, 301);
    }

    // Phase 6 — locale URL prefix detection. If the first segment
    // looks like a locale code (e.g. `/ar/products/foo`), strip it
    // before the [domain] rewrite and stamp the locale on the
    // response headers + cookie. SSR layout reads x-numu-locale and
    // hydrates the SDK with `initialLocale`.
    //
    // This runs *before* the [domain] rewrite so we don't end up
    // with `/<subdomain>/ar/products/...` paths the [domain] page
    // tries to parse as collection slugs.
    let urlPathname = pathname;
    let pathLocale: string | null = null;
    if (isLocalePrefix(firstSeg)) {
      pathLocale = firstSeg.toLowerCase();
      urlPathname = pathname.slice(`/${firstSeg}`.length) || "/";
    }

    // Session E (2026-05-28) — marketplace "Try theme" preview. When
    // the merchant clicks Preview on a catalog card, the hub opens an
    // iframe at the storefront with `?preview_theme_slug=<slug>` and
    // `?editor=v3`. Forward both as request headers so the resolved
    // server-component tree (layout + pages) can branch on them
    // without each one re-parsing the URL — Next.js 15 layouts don't
    // see searchParams, so a header is the only common channel.
    //
    // The preview is read-only by construction: `fetchThemeSettings`
    // in api-client.ts substitutes the marketplace bundle's metadata
    // into the resolved theme settings but never writes to
    // store_themes, store_theme_snapshots, or
    // marketplace_theme_installations.
    const previewSlug = request.nextUrl.searchParams.get("preview_theme_slug");
    const editorFlavor = request.nextUrl.searchParams.get("editor");
    const requestHeaders = new Headers(request.headers);
    if (previewSlug) {
      requestHeaders.set("x-numu-preview-slug", previewSlug);
    }
    if (editorFlavor) {
      requestHeaders.set("x-numu-editor", editorFlavor);
    }

    const url = request.nextUrl.clone();
    url.pathname = `/${storeIdentifier}${urlPathname}`;
    const res = NextResponse.rewrite(url, {
      request: { headers: requestHeaders },
    });
    // Forward the original hostname (without port) so api-client can
    // distinguish subdomain vs custom-domain lookups without re-parsing.
    res.headers.set("x-numu-host", hostname);
    // Stamp the rewritten pathname so the root layout (which doesn't
    // see [domain] params) can resolve the active store for setting
    // `<html lang>` / `<html dir>`.
    res.headers.set("x-numu-pathname", url.pathname);

    // Locale resolution (Phase 3.6 + Phase 6). Order of precedence:
    //   1. URL prefix `/{locale}/...` — explicit, sharable. Stripped
    //      from the rewritten pathname above.
    //   2. ?locale=<code> querystring — also explicit, also persisted.
    //   3. numu_locale cookie — sticky across navigations.
    //   4. (none — layout uses store.default_language)
    //
    // We surface the resolved locale on x-numu-locale so the layout
    // can stamp <html lang> + pass into NuMuProvider as `initialLocale`.
    const queryLocale = request.nextUrl.searchParams.get("locale");
    const cookieLocale = request.cookies.get("numu_locale")?.value;
    const resolvedLocale =
      pathLocale || queryLocale || cookieLocale || "";
    if (resolvedLocale) {
      res.headers.set("x-numu-locale", resolvedLocale);
    }
    // Promote whichever explicit signal wins to the cookie so
    // subsequent navigations honor it without re-providing the prefix
    // or querystring.
    const explicit = pathLocale || queryLocale;
    if (explicit && explicit !== cookieLocale) {
      res.cookies.set("numu_locale", explicit, {
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
        sameSite: "lax",
      });
    }

    // Phase 6 — surface the selected presentment currency so SSR can
    // hydrate <Money> in the merchant's chosen display currency
    // without a client-side reflicker on first paint.
    const currencyCookie = request.cookies.get("numu_currency")?.value;
    if (currencyCookie && /^[A-Z]{3}$/i.test(currencyCookie)) {
      res.headers.set("x-numu-currency", currencyCookie.toUpperCase());
    }
    return res;
  }

  // Apex passthrough still wants the pathname header so root layout
  // can resolve locale when the URL already includes the [domain]
  // segment (the dev path-segment routing case).
  const passthrough = NextResponse.next();
  passthrough.headers.set("x-numu-pathname", pathname);
  return passthrough;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
