import { fetchStoreByDomain, fetchCollectionBySlug, fetchProducts, fetchCollections, fetchThemeSettings } from "@/lib/api-client";
import { slimProductsForTheme } from "@/lib/slim-product";
import { resolveThemeSettings, applyTemplateOverride } from "@/lib/resolve-theme";
import { PageTemplateRenderer } from "@/components/theme-engine/PageTemplateRenderer";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import { resolveThemeSsrHtml } from "@/lib/ssr-theme-request";
import {
  buildBreadcrumbLd,
  buildCollectionLd,
  serializeLd,
} from "@/lib/json-ld";
import { SsrCollectionContent } from "@/components/seo/SsrContentLayer";
import {
  alternatesFor,
  alternatesForEntity,
  entityRobots,
  canonicalFor,
  canonicalOriginFor,
  buildOpenGraph,
  buildTwitter,
  localizedPathFor,
  localizedSeoText,
  storeSocialImage,
  type StoreForSeo,
} from "@/lib/seo";
import { headers } from "next/headers";
import { permanentRedirect } from "next/navigation";
import type { Metadata } from "next";

/**
 * Phase 4.7 — ISR cache: revalidate every 5 minutes.
 *
 * Collection pages aggregate product listings; the same cache
 * pressure analysis as PDPs applies. The API client's
 * `collection:${storeId}:${slug}` revalidation tag fires sooner on
 * explicit publishes (a merchant adding/removing products from a
 * collection invalidates this cache via the hub's publish flow).
 */
export const revalidate = 300;

interface PageProps {
  params: Promise<{ domain: string; slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain, slug } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    const collection = await fetchCollectionBySlug(store.id, slug);
    const storeForSeo = store as unknown as StoreForSeo;
    // Origin via canonicalOriginFor (the ONE implementation) — the local copy
    // this replaces ignored the store's custom domain entirely.
    const hl = await headers();
    // The route's own path plus the visitor URL's locale prefix, so
    // `/ar/collections/x` is its own canonical rather than a declared duplicate
    // of the English URL (which voided the page's hreflang cluster).
    //
    // The slug is the collection's CURRENT one, never the requested one: a
    // renamed collection still resolves through its slug history, and
    // canonicalising the retired URL to itself would declare it the real page
    // and keep the ranking split across both. The page body 301s; this keeps
    // the head honest for anything reading metadata off the pre-redirect
    // response.
    const canonicalSlug = collection?.slug || slug;
    const path = localizedPathFor(hl, domain, `/collections/${canonicalSlug}`);
    // Content locale — also honours ?locale= / the numu_locale cookie, matching
    // what the theme and the SSR content layer render.
    const locale =
      hl.get("x-numu-locale") ||
      (store as { default_language?: string })?.default_language ||
      "en";
    const seoText = localizedSeoText(collection, locale);
    const title = seoText.title || "Collection";
    const description = seoText.description;
    // The collection's own image, falling back to the store's social image so
    // the card is never blank.
    const image = collection?.image_url || storeSocialImage(storeForSeo);
    return {
      // Entity title only — the layout's template appends the store name.
      title,
      description,
      alternates: alternatesForEntity(storeForSeo, domain, path, collection),
      // The store gate plus the merchant's per-collection noindex switch.
      robots: entityRobots(storeForSeo, collection),
      // og:url was missing entirely, so scrapers fell back to the requested
      // URL or (worse) the layout's origin-wide value. Built with the shared
      // helper so siteName + og:locale come along too.
      openGraph: buildOpenGraph(storeForSeo, {
        title,
        description,
        url: canonicalFor(storeForSeo, domain, path),
        image,
      }),
      // Declaring openGraph REPLACES the layout's, but twitter was still
      // inherited — so the card showed the STORE's title and image next to
      // this collection's og:title. Give the route its own.
      twitter: buildTwitter({ title, description, image }),
    };
  } catch {
    return { title: "Collection" };
  }
}

export default async function CollectionPage({ params }: PageProps) {
  const { domain, slug } = await params;

  const store = await fetchStoreByDomain(domain);
  const collection = await fetchCollectionBySlug(store.id, slug);

  // ADR-7 — the visitor's locale (see the PDP route). Feeds both the
  // crawler-facing content layer and the structured data below; read up here
  // because the canonical redirect just below needs the same header bag.
  const hl = await headers();

  // Renamed collection: the resolver matched a retired slug (previous_slugs)
  // and returned the CURRENT collection — send crawlers and shoppers to the
  // canonical URL. A 301 hands the old URL's ranking to the new one; a 404
  // throws it away. Redirect BEFORE the product fetch below so a rotted link
  // doesn't pay for a 500-product query it will never render.
  //
  // Store segment and locale segment are both rebuilt by hand, exactly as on
  // the PDP: `x-numu-host` is stamped only by the host→path rewrite, so its
  // ABSENCE identifies the local path-routing entry point where dropping the
  // store segment lands on "Store not found"; and `localizedPathFor` puts back
  // the `/ar` prefix proxy.ts strips, so an Arabic inbound link isn't 301'd
  // onto its English twin.
  //
  // `encodeURIComponent` because the backend slugifies category names with
  // `allow_unicode=True`, so a collection slug is legitimately Arabic — and a
  // raw non-ASCII path in a `Location` header is not a valid redirect. The
  // comparison above stays on the DECODED forms, which is what `params` holds.
  if (collection?.slug && collection.slug !== slug) {
    const storePrefix = hl.get("x-numu-host") ? "" : `/${domain}`;
    const target = localizedPathFor(
      hl,
      domain,
      `/collections/${encodeURIComponent(collection.slug)}`,
    );
    permanentRedirect(`${storePrefix}${target}`);
  }

  // Fetch the collection's products so the bundle's grid has something to
  // render. Without this the listing falls back to an empty catalog
  // (useProducts() does NOT self-fetch) and shows "No results".
  // Admin-only columns stripped before these rows become RSC props — this
  // list is inlined into the document verbatim. See lib/slim-product.ts.
  const products = collection?.id
    ? slimProductsForTheme(
        await fetchProducts(store.id, 500, collection.id).catch(() => []),
      )
    : [];
  // Full collections list so the header's collections dropdown renders on
  // collection pages too (not just home).
  const collections = await fetchCollections(store.id).catch(() => []);
  const themeRaw = await fetchThemeSettings(store.id);
  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});
  // Template overrides: honour an alternate collection template
  // (collection.template_suffix → `collection.<suffix>`) in both render paths.
  // No-ops until the collection payload carries template_suffix (backend follow-up).
  const effectiveTheme = applyTemplateOverride(
    themeSettings,
    "collection",
    (collection as { template_suffix?: string | null } | null)?.template_suffix ?? null,
  );

  const visitorLocale =
    hl.get("x-numu-locale") ||
    (store as { default_language?: string })?.default_language ||
    "en";

  // JSON-LD: emit a CollectionPage block + breadcrumbs so search
  // engines surface "Collection: <name>" results with the right URL.
  const baseUrl = canonicalOriginFor(store as unknown as StoreForSeo, domain);
  const collectionLd = collection
    ? buildCollectionLd({
        collection,
        baseUrl,
        // Arabic when the visitor is on Arabic. The category payload carries no
        // Arabic columns TODAY, so this resolves to the English name until the
        // backend exposes `attributes.nameAr` for collections — wired now so the
        // Arabic URL stops hard-coding English the moment it does.
        seoText: localizedSeoText(collection, visitorLocale),
      })
    : null;
  const breadcrumbLd = collection
    ? buildBreadcrumbLd({
        trail: [
          { name: "Home", url: baseUrl },
          { name: "Collections", url: `${baseUrl}/collections/all` },
          { name: collection.name || "Collection" },
        ],
      })
    : null;
  const ldBlocks = [collectionLd, breadcrumbLd].filter(Boolean);
  const ldScripts = ldBlocks.map((ld, i) => (
    <script
      key={`ld-${i}`}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeLd(ld) }}
    />
  ));

  // Built-in collection view — the ENG-2 no-blank backstop (and the
  // built-in-theme fallback): a theme that ships no `collection` template
  // would otherwise render an empty page. Shows the collection heading +
  // description so the route is never blank.
  const builtInCollection = (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold">{collection?.name || "Collection"}</h1>
      <p className="text-gray-600 mt-4">{collection?.description || ""}</p>
    </div>
  );

  // BYOT: hand the bundle the page context so it knows to render its
  // collection template. Same fork the home route uses.
  if (
    themeSettings.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id)
  ) {
    // ONE page descriptor shared by the server render and the client mount.
    const pageCtx = {
      type: "collection" as const,
      title: collection?.name,
      handle: slug,
      // `products` feeds useProducts() (what the grid actually reads
      // today). `collection` carries name/description + its products
      // for useCollectionOptional() once the SDK wires the singular
      // CollectionProvider — harmless until then.
      data: {
        products,
        collections,
        collection: collection ? { ...collection, products } : undefined,
      },
    };
    // Isolated theme SSR (dark unless NUMU_SSR_THEME=1); null → unchanged.
    const ssrHtml = await resolveThemeSsrHtml({
      themeSettings: effectiveTheme,
      store,
      page: pageCtx,
    });
    return (
      <>
        {ldScripts}
        <ByotThemeBoundary
          bundleUrl={themeSettings.external_theme.bundle_url}
          bundleChecksum={themeSettings.external_theme.checksum}
          cssUrl={themeSettings.external_theme.css_url}
          themeSettings={effectiveTheme}
          storeData={store}
          page={pageCtx}
          ssrHtml={ssrHtml}
          routeFallback={builtInCollection}
          // ADR-7 — semantic collection body (title, description, the grid as
          // real product links with prices) in the initial HTML. Dropped on
          // hydration; present even when the theme's template renders.
          seoContent={
            <SsrCollectionContent
              collection={collection}
              products={products}
              storeName={store?.name}
              storeCurrency={store?.currency}
              locale={visitorLocale}
            />
          }
        />
      </>
    );
  }

  const collectionTemplate = effectiveTheme.templates?.collection;
  if (collectionTemplate) {
    return (
      <>
        {ldScripts}
        <PageTemplateRenderer
          template={collectionTemplate}
          themeId={themeSettings.theme_id}
          storeData={store}
        />
      </>
    );
  }

  return (
    <>
      {ldScripts}
      {builtInCollection}
    </>
  );
}
