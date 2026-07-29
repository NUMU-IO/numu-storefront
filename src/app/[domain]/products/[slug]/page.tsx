import {
  fetchStoreByDomain,
  fetchProductBySlug,
  fetchThemeSettings,
  fetchProducts,
  fetchCollections,
} from "@/lib/api-client";
import { resolveThemeSettings, applyTemplateOverride } from "@/lib/resolve-theme";
import { PageTemplateRenderer } from "@/components/theme-engine/PageTemplateRenderer";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import { resolveThemeSsrHtml } from "@/lib/ssr-theme-request";
import BuiltInProductDetail from "@/components/storefront/BuiltInProductDetail";
import {
  buildBreadcrumbLd,
  buildProductLd,
  serializeLd,
} from "@/lib/json-ld";
import { FunnelTracker } from "@/components/tracking/FunnelTracker";
import {
  alternatesFor,
  alternatesForEntity,
  entityRobots,
  canonicalFor,
  canonicalOriginFor,
  localizedPathFor,
  localizedSeoText,
  productOgProperties,
  storeRobots,
  NOINDEX_ROBOTS,
  type StoreForSeo,
} from "@/lib/seo";
import { SsrProductContent } from "@/components/seo/SsrContentLayer";
import { headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string; slug: string }>;
}

/**
 * Phase 4.7 — ISR cache: revalidate every 5 minutes.
 *
 * PDPs change less frequently than the home page but are the
 * most-trafficked individual URLs after `/`. 5-minute ISR keeps
 * cache pressure off the API for hot products while still picking
 * up inventory + price edits in a window short enough that "out of
 * stock" surfaces before frustrating an active shopper. The API
 * client's `product:${storeId}:${slug}` revalidation tag fires
 * sooner on explicit publishes.
 */
export const revalidate = 300;

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain, slug } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    const product = await fetchProductBySlug(store.id, slug);
    // URLs from the shared helpers (the ONE origin implementation) — the local
    // storeBaseUrl() this replaces ignored the store's custom domain entirely,
    // so a store on a verified custom domain canonicalised its PDPs onto the
    // platform subdomain instead.
    const storeForSeo = store as unknown as StoreForSeo;
    const hl = await headers();
    // The route's own path, carrying the visitor URL's locale prefix, so
    // `/ar/products/x` canonicalises to ITSELF instead of to its English twin
    // (which made Google discard the page's whole hreflang cluster).
    //
    // The slug is the product's CURRENT one, never the requested one: a
    // renamed product still resolves through its slug history, so
    // `/products/<old-slug>` gets a real payload — and canonicalising THAT
    // URL to itself would declare the retired URL the real page and keep the
    // ranking split across both instead of consolidating it on the new one.
    // (The page body 301s; this keeps the head honest for anything reading
    // metadata off the pre-redirect response.)
    const canonicalSlug = product?.slug || slug;
    const path = localizedPathFor(hl, domain, `/products/${canonicalSlug}`);
    const canonical = canonicalFor(storeForSeo, domain, path);
    // Content locale is a SEPARATE signal from the URL prefix above: it also
    // honours `?locale=` and the `numu_locale` cookie, matching what the theme,
    // the SSR content layer and `<html lang>` render.
    const locale = hl.get("x-numu-locale") || store?.default_language || "en";
    // Entity title only — the `[domain]` layout's title template appends the
    // store name. OG/Twitter reuse the same strings so the cards mirror the
    // merchant's SEO edits (seo_title/seo_description) rather than plain
    // name/description — these tags are what link-preview tools render.
    // `/ar/...` used to emit the English seo_title/seo_description here, i.e.
    // described an indexable Arabic URL in the one language an Arabic query
    // can't match.
    const seoText = localizedSeoText(product, locale);
    // "Product" is the last-resort default, for a payload with no usable copy
    // in either language (a null product on a 404, say).
    const ptitle = seoText.title || "Product";
    const pdesc = seoText.description;
    const productActive =
      String(product?.status ?? "active").toLowerCase() === "active";
    return {
      title: ptitle,
      description: pdesc,
      alternates: alternatesForEntity(storeForSeo, domain, path, product),
      openGraph: {
        title: ptitle,
        description: pdesc,
        // No `type` on purpose. A PDP must declare og:type=product, but Next's
        // OpenGraphType union has no "product" and its renderer THROWS on an
        // unknown type ("Invalid OpenGraph type", E237) — so og:type and the
        // product:* properties are emitted as <meta property> tags from the
        // page body instead (see productOgProperties). Leaving "website" here
        // was what told Meta's crawler this commerce page is generic content.
        url: canonical,
        siteName: store?.name,
        // Deliberately NO `images` key: the generated card at
        // ./opengraph-image.tsx supplies it. Next decides whether the
        // file-convention image applies with a `hasOwnProperty("images")`
        // test, so `images: undefined` is NOT the same as omitting the key —
        // writing it at all suppressed the convention. The previous
        // `images: firstPhoto ? [firstPhoto] : undefined` therefore got the
        // worst of both: a product WITH a photo shipped that raw portrait webp
        // as its share card (wrong aspect for 1200x630, and webp unfurls
        // poorly), and a product WITHOUT one shipped no og:image whatsoever —
        // the exact hole the generated card exists to close.
      },
      twitter: {
        // Always the large card now: the convention guarantees an image, so
        // there is no "summary" case left to fall back to. Omitting
        // `twitter.images` lets Next reuse the OpenGraph one, which keeps the
        // two previews identical instead of pairing a branded card on Facebook
        // with a bare product photo on X.
        card: "summary_large_image",
        title: ptitle,
        description: pdesc,
      },
      // noindex a draft/archived product, a non-indexable store, or a product
      // the merchant flipped out of the index.
      robots: entityRobots(storeForSeo, product, {
        forceNoindex: !productActive,
      }),
    };
  } catch {
    return { title: "Product", robots: NOINDEX_ROBOTS };
  }
}

export default async function ProductPage({ params }: PageProps) {
  const { domain, slug } = await params;

  const store = await fetchStoreByDomain(domain);
  // A missing/invalid slug must NOT crash the Server Components render, but a
  // transient 5xx/network blip must NOT masquerade as a missing product
  // either (that would wrongly serve a 404 + noindex for a real, live
  // product). fetchProductBySlug throws "API error: <status> …" for every
  // non-OK response — only treat a genuine 404 as "no such product"; rethrow
  // anything else so the error boundary shows a retryable error instead.
  // product, theme and catalogue all key off `store.id` and are independent —
  // fetch them in PARALLEL so SSR is bounded by the slowest call, not the sum
  // of three serial round-trips. The product error is captured (not thrown into
  // Promise.all) so we keep the contract: a genuine 404 → notFound below, a
  // transient 5xx/network blip → rethrow → retryable error boundary (NOT a
  // wrong 404+noindex). theme + catalogue are best-effort:
  //   - theme: a hiccup must NOT crash the PDP (it surfaced as "Something went
  //     wrong"); empty settings → no bundle_url → built-in PDP fallback renders
  //     the product, add-to-cart intact.
  //   - catalogue: only feeds the bundle's "you may also like" rail.
  const [productResult, themeRaw, catalogue, collections] = await Promise.all([
    fetchProductBySlug(store.id, slug).then(
      (p) => ({ ok: true as const, product: p }),
      (err: unknown) => ({ ok: false as const, error: err }),
    ),
    fetchThemeSettings(store.id).catch(() => null),
    fetchProducts(store.id, 12).catch(() => []),
    // header collections dropdown parity with the home route
    fetchCollections(store.id).catch(() => []),
  ]);
  let product = null;
  if (productResult.ok) {
    product = productResult.product;
  } else {
    const msg =
      productResult.error instanceof Error
        ? productResult.error.message
        : String(productResult.error);
    if (!msg.includes("API error: 404")) throw productResult.error;
  }
  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});
  // Template overrides: if this product opts into an alternate template
  // (product.template_suffix → `product.<suffix>`), swap it in so BOTH the BYOT
  // bundle and the built-in renderer pick up the variant's sections.
  const effectiveTheme = applyTemplateOverride(
    themeSettings,
    "product",
    product?.template_suffix ?? null,
  );

  const isByotTheme =
    !!themeSettings.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id);

  // BYOT: a genuinely-missing product → the theme's styled `404` template
  // (via [domain]/not-found.tsx), not a ghost placeholder PDP and not a
  // crash. Built-in themes keep their inline "no longer available" fallback
  // below.
  if (isByotTheme && !product) {
    notFound();
  }

  // ADR-7 — the visitor's locale, from the `x-numu-locale` the proxy stamps
  // (URL prefix › ?locale › cookie › store default). Feeds BOTH the
  // crawler-facing content layer and the structured data below; this route
  // already renders dynamically (the layout reads headers/cookies) so reading
  // it here costs nothing.
  const hl = await headers();

  // Renamed product: the backend resolved a retired slug (previous_slugs) and
  // returned the CURRENT product — send crawlers and shoppers to the canonical
  // URL. A 301 hands the old URL's accumulated ranking to the new one; the 404
  // this replaces threw it away.
  //
  // Two prefixes have to be rebuilt by hand, and dropping either turns this
  // fix into a different kind of link rot:
  //   - the store segment. On a real store the proxy rewrites host→path so the
  //     browser's URL has none and a bare `/products/…` is right; under the
  //     local path-routing entry point (127.0.0.1:3100/testlocal/…) the segment
  //     IS in the URL and dropping it lands on a store-less path that renders
  //     "Store not found". `x-numu-host` is stamped only by the rewrite branch,
  //     so its ABSENCE is what identifies path routing.
  //   - the LOCALE segment, via the same helper generateMetadata canonicalises
  //     with. proxy.ts strips `/ar` before the rewrite, so a hand-built
  //     `/products/<slug>` would 301 every Arabic inbound link onto its English
  //     twin — collapsing the hreflang cluster this route works to keep intact.
  //
  // Encoded for the same reason the sitemap encodes: a raw non-ASCII path in a
  // `Location` header is not a valid redirect. The comparison stays on the
  // DECODED forms, which is what `params` holds.
  if (product?.slug && product.slug !== slug) {
    const storePrefix = hl.get("x-numu-host") ? "" : `/${domain}`;
    const target = localizedPathFor(
      hl,
      domain,
      `/products/${encodeURIComponent(product.slug)}`,
    );
    permanentRedirect(`${storePrefix}${target}`);
  }

  // JSON-LD for product + breadcrumb. We render the script tag
  // alongside whatever template the store uses (BYOT or built-in)
  // so the structured data is in the rendered HTML regardless of
  // which path renders the page body. Both LDs are emitted as a
  // single script — Google parses each top-level value separately.
  const storeForSeo = store as unknown as StoreForSeo;
  const baseUrl = canonicalOriginFor(storeForSeo, domain);
  const visitorLocale = hl.get("x-numu-locale") || store?.default_language || "en";
  // ONE resolved currency for the structured data AND the OG properties —
  // product.currency falls back to "USD" at the fetch boundary, so an EGP
  // store with the field unset would otherwise publish a price in dollars.
  const ldCurrency = product?.currency || store?.currency || "EGP";
  // `product.name`/`description` are already Arabic here (normalizeProduct
  // substitutes at the fetch boundary), but `seo_title`/`seo_description` are
  // English-only columns AND win over the name inside buildProductLd — so
  // without this an Arabic PDP published an English Product name to Google.
  const ldSeoText = localizedSeoText(product, visitorLocale);
  const productLd = product
    ? buildProductLd({
        product: { ...product, currency: ldCurrency },
        baseUrl,
        storeName: store?.name,
        seoText: ldSeoText,
        // Only assert the return window the merchant actually claimed in the
        // hub's SEO settings.
        hasReturnPolicy30d: storeForSeo.seo?.has_return_policy_30d === true,
        // NOTE: `reviews` is intentionally unset — there is no server-side
        // reviews fetcher in api-client yet (only the client-facing
        // /api/storefront/products/[id]/reviews proxy), so aggregateRating
        // stays off rather than being guessed.
      })
    : null;
  const breadcrumbLd = product
    ? buildBreadcrumbLd({
        trail: [
          { name: "Home", url: baseUrl },
          { name: product.name || "Product" },
        ],
      })
    : null;
  const ldBlocks = [productLd, breadcrumbLd].filter(Boolean);

  const ldScripts = ldBlocks.map((ld, i) => (
    <script
      key={`ld-${i}`}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeLd(ld) }}
    />
  ));

  // og:type=product + product:* properties. Rendered here rather than in
  // generateMetadata because Next's metadata layer can express neither: its
  // OpenGraph type union has no "product" (and throws on one), and its `other`
  // block emits `<meta name>` where OGP needs `<meta property>`. React hoists
  // these into <head> exactly like the rel=preload link below.
  const ogProductMetas = product
    ? productOgProperties({
        price: product.price,
        currency: ldCurrency,
        inStock: !!product.in_stock,
        sku: product.sku,
        brand: store?.name,
      }).map(([property, content]) => (
        <meta key={`og-${property}`} property={property} content={content} />
      ))
    : [];

  // Meta ViewContent — rides along with the LD scripts so it fires in every
  // render branch (BYOT / template / built-in). Value in MAJOR units.
  const viewContent = product ? (
    <FunnelTracker
      key="vc"
      step="product_view"
      data={{
        content_ids: [product.meta_catalog_id || product.id],
        content_name: product.name,
        content_type: "product",
        value: product.price,
        currency: product.currency || store?.currency || "EGP",
      }}
    />
  ) : null;
  // Preload the LCP image (the product's first image) so it downloads during
  // HTML parse — in parallel with the theme bundle. A BYOT PDP paints client-
  // side, so without this the main image only starts loading AFTER the bundle
  // mounts and renders the <img>. Next hoists `rel="preload"` to <head>.
  const lcpImageUrl = product?.images?.[0]?.url;
  const imagePreload = lcpImageUrl ? (
    <link
      key="lcp-img"
      rel="preload"
      as="image"
      href={lcpImageUrl}
      fetchPriority="high"
    />
  ) : null;
  const headExtras = [
    ...(imagePreload ? [imagePreload] : []),
    ...ogProductMetas,
    ...ldScripts,
    ...(viewContent ? [viewContent] : []),
  ];

  // BYOT: hand the bundle the page context so it knows to render its
  // product template. Same fork the home route uses.
  if (
    themeSettings.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id)
  ) {
    // ONE page descriptor shared by the server render and the client mount —
    // parity is what keeps hydration from tearing the DOM down.
    const pageCtx = {
      type: "product" as const,
      title: product?.name,
      handle: slug,
      data: product
        ? { product, products: catalogue, collections }
        : undefined,
    };
    // Isolated theme SSR (dark unless NUMU_SSR_THEME=1); null → unchanged.
    const ssrHtml = await resolveThemeSsrHtml({
      themeSettings: effectiveTheme,
      store,
      page: pageCtx,
    });
    return (
      <>
        {headExtras}
        <ByotThemeBoundary
          bundleUrl={themeSettings.external_theme.bundle_url}
          bundleChecksum={themeSettings.external_theme.checksum}
          cssUrl={themeSettings.external_theme.css_url}
          themeSettings={effectiveTheme}
          storeData={store}
          page={pageCtx}
          ssrHtml={ssrHtml}
          // ENG-2 defense-in-depth: every registered theme ships a `product`
          // template, but if a bundle renders blank fall back to the functional
          // built-in PDP (product is non-null here — the !product BYOT case
          // notFound()s above). Add-to-cart stays reachable.
          routeFallback={
            product ? (
              <BuiltInProductDetail
                product={{ ...product, currency: product.currency || store?.currency }}
              />
            ) : undefined
          }
          // ADR-7 — semantic, crawler-facing PDP body in the initial HTML.
          // Unlike routeFallback this ships even when the theme renders; the
          // boundary drops it on hydration, before the bundle paints.
          seoContent={
            <SsrProductContent
              product={product}
              storeName={store?.name}
              storeCurrency={store?.currency}
              locale={visitorLocale}
            />
          }
        />
      </>
    );
  }

  const productTemplate = effectiveTheme.templates?.product;
  if (productTemplate) {
    return (
      <>
        {headExtras}
        <PageTemplateRenderer
          template={productTemplate}
          themeId={themeSettings.theme_id}
          storeData={store}
        />
      </>
    );
  }

  // Fallback PDP — variant picker + qty + add-to-cart. Lands when the
  // store has no PDP template configured (vanilla bazar / fresh stores)
  // and no BYOT bundle. Anything more elaborate is the theme's job.
  if (!product) {
    return (
      <>
        {headExtras}
        <div className="max-w-4xl mx-auto p-8 text-center text-gray-500">
          This product is no longer available.
        </div>
      </>
    );
  }
  return (
    <>
      {headExtras}
      <BuiltInProductDetail
        product={{
          ...product,
          currency: product.currency || store?.currency,
        }}
      />
    </>
  );
}
