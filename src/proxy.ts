import { NextRequest, NextResponse } from "next/server";
import { resolveImageTransform } from "@/lib/image-transform";

// Port-stripped, because every comparison below is against a port-stripped
// hostname. The documented dev value is `localhost:3100`, so leaving the port
// on made `hostname.endsWith(".localhost:3100")` permanently false and silently
// disabled the host-rewrite branches in dev. `api-client.ts` strips both sides
// for exactly this reason; this file didn't. Harmless in prod (`numueg.app`
// carries no port) — which is why it went unnoticed.
const PLATFORM_DOMAIN = (process.env.NUMU_PLATFORM_DOMAIN || "numueg.app").split(
  ":",
)[0];

// Subdomain segments that come AFTER the [domain] in path routing.
// When the proxy sees one of these as the first path segment, it
// implies the request is missing its subdomain prefix and we need to
// rebase under whichever subdomain we can recover from Referer/cookie.
const POST_DOMAIN_SEGMENTS = new Set([
  "collections",
  "products",
  "cart",
  "checkout",
  "pay",
  "account",
  "search",
  "pages",
  "blogs",
  "policies",
  "password",
]);

// Genuine static assets bypass the tenant rewrite entirely. We match by
// extension rather than the old naive `pathname.includes(".")` — that dot-check
// also swallowed the DYNAMIC per-store metadata routes `/robots.txt` and
// `/sitemap.xml` (see [domain]/robots.ts + [domain]/sitemap.ts), which contain
// a dot but must be rewritten under the store's path segment like any other
// tenant route. `.txt`/`.xml` stay listed for real static files; the two
// metadata paths are special-cased ahead of this check below.
const STATIC_FILE_EXT_RE =
  /\.(?:js|mjs|cjs|css|map|json|txt|xml|ico|png|jpe?g|gif|svg|webp|avif|bmp|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav|pdf|wasm)$/i;

// Dotted paths that MUST route through the subdomain→path rewrite so the
// `[domain]/sitemap.ts` metadata handler is reachable per store.
//
// `/robots.txt` is deliberately NOT here. Next registers `robots` only from
// `app/robots.ts` (unlike `sitemap`, which is segment-aware), so the handler
// lives at the root and must be reached at the root — rewriting it under the
// store segment routes it to a file that doesn't exist. It still renders
// per-store output: it resolves the store from the Host header, same as the
// sitemap does when Next calls it without params.
const TENANT_METADATA_PATHS = new Set(["/sitemap.xml"]);

// Phase 6 — locale URL prefixes. We accept any 2-character ISO 639-1
// code in the first path segment; the SSR layer validates against the
// store's actual locale list and falls back to default_language for
// unknown codes. Two letters is the common shape today (`/ar/...`,
// `/en/...`); regional sub-tags (`/zh-tw/...`) can ride the same
// matcher if we extend to 2-5 chars later. We intentionally do NOT
// hard-code a whitelist — themes / merchants may add locales over
// time, and the SSR handles the fallback gracefully.
/**
 * The platform's own origin, as opposed to a merchant store host.
 *
 * Extracted from the apex-passthrough branch because the agent-discovery
 * carve-out (further down) has to make the same distinction BEFORE that branch
 * runs: a `/.well-known/*` document on `numueg.app` describes the platform and
 * belongs to the landing-page repo, while one on `<store>.numueg.app`
 * describes that merchant. Two callers, one definition.
 */
function isApexHost(hostname: string): boolean {
  return (
    hostname === PLATFORM_DOMAIN ||
    hostname === `www.${PLATFORM_DOMAIN}` ||
    hostname === "localhost" ||
    hostname === "127.0.0.1"
  );
}

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
  // ── Image transform: rewrite, don't redirect ──────────────────────────────
  //
  // `/api/image-transform` is the stable image URL every theme builds. Its
  // route handler can only ANSWER or REDIRECT, so it answered with a 302 to
  // `/_next/image` — an extra round trip for every image on the page. Measured
  // on vionne's mobile run: ~1.6 s on the hero alone, repeated for each of the
  // 12 product thumbnails.
  //
  // Middleware can `rewrite()`, which reaches the same bytes with no hop at
  // all. `resolveImageTransform` is the SAME function the route calls, so the
  // SSRF allowlist and the width/quality clamps are unchanged — this only
  // removes the round trip. The CF branch still returns `redirect`, which we
  // pass through to the handler: `/cdn-cgi/image/…` lives at Cloudflare's edge,
  // and rewriting to it would resolve against Next and 404.
  if (pathname === "/api/image-transform") {
    const decision = resolveImageTransform(request.nextUrl.searchParams);
    if (decision.kind === "rewrite") {
      return NextResponse.rewrite(new URL(decision.path, request.url));
    }
    return NextResponse.next();
  }

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

  // ── Agent-discovery documents ─────────────────────────────────────────────
  //
  // `/.well-known/*` and `/openapi.json` used to fall through to the
  // subdomain→path rewrite and land on the `[...slug]` catch-all, which is a
  // deliberate NO-404 engine — so every probe got `200 text/html`. A `.json`
  // path answering HTML is precisely what makes agent tooling report
  // "returned HTML instead of JSON", and a 200 for a document we do not
  // publish is a worse answer than a 404.
  //
  // Handled HERE rather than as app routes because Next's file-system router
  // does not register a `.well-known` app segment. The catch-all itself is
  // untouched: this carve-out is limited to these exact paths, so theme routes
  // still never dead-end.
  //
  // Apex is out of scope — a document on `numueg.app` describes the PLATFORM
  // and is owned separately; this branch only answers for store hosts.
  if (
    !isApexHost(hostname) &&
    (pathname === "/openapi.json" || pathname.startsWith("/.well-known/"))
  ) {
    // ACME HTTP-01 must never be intercepted — answering 404 here would break
    // certificate issuance/renewal for every custom domain on the platform.
    if (pathname.startsWith("/.well-known/acme-challenge/")) {
      return NextResponse.next();
    }
    if (pathname === "/openapi.json") {
      return NextResponse.rewrite(new URL("/api/agent/openapi", request.url));
    }
    if (pathname === "/.well-known/acp.json") {
      return NextResponse.rewrite(new URL("/api/agent/acp", request.url));
    }
    // Honest 404 for everything we do not publish. See WP10 in the remediation
    // plan for why OAuth/OIDC discovery, x402, MPP and UCP are deliberately
    // absent: advertising endpoints that do not exist is worse than silence.
    return NextResponse.json(
      {
        error: "not_found",
        message: `No document is published at ${pathname}.`,
      },
      { status: 404, headers: { "Cache-Control": "public, max-age=3600" } },
    );
  }

  // Skip Next internals + genuine static assets. Unlike the old naive
  // `pathname.includes(".")`, this lets `/sitemap.xml` fall through to the
  // subdomain→path rewrite below while real assets (.js/.css/images/fonts/
  // .map/…) still bypass. `/robots.txt` bypasses here on purpose — it is
  // served by the ROOT `app/robots.ts` (see TENANT_METADATA_PATHS above).
  if (
    !TENANT_METADATA_PATHS.has(pathname) &&
    (pathname.startsWith("/_next/") || STATIC_FILE_EXT_RE.test(pathname))
  ) {
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
  if (isApexHost(hostname)) {
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
    // `/robots.txt` + `/sitemap.xml` rebase too: they only exist under
    // `[domain]`, so a bare apex hit would 404 in dev (prod rewrites at
    // the edge before this ever runs). Same two signals resolve the store.
    const firstSeg = pathname.split("/")[1] || "";
    if (POST_DOMAIN_SEGMENTS.has(firstSeg) || TENANT_METADATA_PATHS.has(pathname)) {
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
    // Offers-v2 promotion preview. The merchant hub's "Preview in store"
    // opens `<subdomain>.numueg.app/?_npt=<jwt>`; forward the token as a
    // request header so the SSR layout (which can't see searchParams) can
    // pass it to the promotions fetch, which surfaces DRAFT/SCHEDULED/PAUSED
    // promos the merchant hasn't published yet. Same channel as the theme
    // preview slug above.
    const promoPreviewToken = request.nextUrl.searchParams.get("_npt");
    const requestHeaders = new Headers(request.headers);
    if (previewSlug) {
      requestHeaders.set("x-numu-preview-slug", previewSlug);
    }
    if (editorFlavor) {
      requestHeaders.set("x-numu-editor", editorFlavor);
    }
    if (promoPreviewToken) {
      requestHeaders.set("x-numu-promo-preview-token", promoPreviewToken);
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
    // …and the PRE-strip, visitor-facing pathname (`/ar/products/x`, where
    // x-numu-pathname holds `/vionne/products/x`).
    //
    // The locale prefix is stripped above, BEFORE the header is stamped, so
    // from `x-numu-pathname` alone a shared layout cannot tell which locale URL
    // the visitor asked for. Every `/ar/...` URL therefore rebuilt its canonical
    // as the un-prefixed English twin while hreflang advertised `/ar/...` as a
    // real alternate — and Google discards a whole hreflang cluster whose
    // annotations don't sit on self-canonical pages, so Arabic could not rank at
    // all despite being served in full.
    //
    // A SECOND header rather than a changed one: `x-numu-pathname` has other
    // readers (the root layout's <html lang>/<html dir> store lookup, the
    // password gate, the checkout layout) that want the REWRITTEN form.
    res.headers.set("x-numu-visitor-path", pathname);

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

    // ── Document-only response headers ────────────────────────────────────
    // Scoped to real navigations. This rewrite branch also carries
    // /sitemap.xml, /llms.txt and other non-HTML tenant documents, and neither
    // header below is correct for those.
    const isDocumentNav =
      request.headers.get("sec-fetch-dest") === "document" ||
      (request.headers.get("accept") || "").includes("text/html");

    if (isDocumentNav) {
      // WP4 — restore back/forward cache.
      //
      // Chrome refuses to bf-cache any page whose MAIN RESOURCE was served
      // with `no-store`, and Lighthouse flagged that as the one *Actionable*
      // bf-cache reason. On a store, back-navigation is the single most common
      // move a shopper makes (product → back → grid), and every one of them was
      // a full re-render.
      //
      // The `no-store` was NOT caused by the `cache: "no-store"` fetches in
      // api-client (those are the cart/customer/checkout/preview paths and are
      // correct as they are). It is Next's standard header for a DYNAMIC route,
      // and `[domain]/layout.tsx` is unavoidably dynamic: it reads `cookies()`
      // for the store password gate, WRITES the `numu_active_store` cookie, and
      // reads `x-numu-locale` / `x-numu-promo-preview-token`. `export const
      // revalidate = 60` in page.tsx has never had any effect because of it.
      //
      // So the document genuinely varies per visitor and must NOT become
      // shared-cacheable — `private` stays, and `cf-cache-status: HIT` is
      // deliberately NOT a goal here. Caching a password-gated, locale-specific
      // document at the edge would serve one shopper's state to another. What
      // we can safely drop is `no-store`, which buys bf-cache and nothing else.
      res.headers.set("Cache-Control", "private, max-age=0, must-revalidate");

      // WP9.1 — RFC 8288 discovery. Both targets are real routes in this repo
      // (`app/llms.txt`, `app/[domain]/sitemap.ts`), so neither advertises
      // something that does not exist.
      res.headers.set(
        "Link",
        '</llms.txt>; rel="describedby"; type="text/plain", ' +
          '</sitemap.xml>; rel="sitemap"; type="application/xml"',
      );
    }
    return res;
  }

  // Apex passthrough still wants the pathname header so root layout
  // can resolve locale when the URL already includes the [domain]
  // segment (the dev path-segment routing case).
  const passthrough = NextResponse.next();
  passthrough.headers.set("x-numu-pathname", pathname);
  // Nothing is stripped on this branch, so the visitor-facing pathname IS the
  // request pathname — stamped anyway so every storefront response carries the
  // header and no reader has to know which branch produced it.
  passthrough.headers.set("x-numu-visitor-path", pathname);
  // …and the locale, for the same reason. Resolution used to live only inside
  // the rewrite branch, so on the path-segment entry point `?locale=ar` was a
  // no-op: the copy switched to Arabic (the cookie reaches the client) while
  // `<html dir>` stayed `ltr`, i.e. Arabic text in an LTR layout. Production
  // stores are all on subdomains so this never shipped, but it made every
  // local RTL check quietly untrustworthy.
  const apexLocale =
    request.nextUrl.searchParams.get("locale") ||
    request.cookies.get("numu_locale")?.value ||
    "";
  if (apexLocale) {
    passthrough.headers.set("x-numu-locale", apexLocale);
  }
  return passthrough;
}

export const config = {
  // NOTE: `/api` is intentionally INCLUDED so the middleware can inject a
  // canonical `x-numu-host` for client cart/checkout calls on deep platform
  // hosts (the `/api/` branch above returns early before any page rewrite).
  // Excluding it leaves those calls forwarding the deep host → backend can't
  // resolve the store → 400/404 (add-to-cart broken).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
