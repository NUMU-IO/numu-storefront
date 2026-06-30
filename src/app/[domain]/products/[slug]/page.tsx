import {
  fetchStoreByDomain,
  fetchProductBySlug,
  fetchThemeSettings,
  fetchProducts,
} from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { PageTemplateRenderer } from "@/components/theme-engine/PageTemplateRenderer";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import BuiltInProductDetail from "@/components/storefront/BuiltInProductDetail";
import {
  buildBreadcrumbLd,
  buildProductLd,
  serializeLd,
} from "@/lib/json-ld";
import { FunnelTracker } from "@/components/tracking/FunnelTracker";
import { storeRobots, NOINDEX_ROBOTS, type StoreForSeo } from "@/lib/seo";
import { notFound } from "next/navigation";
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

function storeBaseUrl(domain: string): string {
  const platformDomain = process.env.NUMU_PLATFORM_DOMAIN || "numueg.app";
  const isProd = process.env.NEXT_PUBLIC_NUMU_ENV === "production";
  return isProd
    ? `https://${domain}.${platformDomain}`
    : `http://localhost:3000/${domain}`;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain, slug } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    const product = await fetchProductBySlug(store.id, slug);
    const canonical = `${storeBaseUrl(domain)}/products/${slug}`;
    const ptitle = `${product?.seo_title || product?.name || "Product"} | ${store?.name || "Store"}`;
    const pdesc = product?.seo_description || product?.description || "";
    const pimg = product?.images?.[0]?.url || undefined;
    // OG/Twitter cards must mirror the merchant's SEO edits
    // (seo_title/seo_description), not just name/description — these tags are
    // what social platforms and link-preview tools actually render.
    const ogTitle = product?.seo_title || product?.name || "Product";
    const productActive =
      String(product?.status ?? "active").toLowerCase() === "active";
    return {
      title: ptitle,
      description: pdesc,
      alternates: { canonical },
      openGraph: {
        title: ogTitle,
        description: pdesc,
        type: "website",
        url: canonical,
        siteName: store?.name,
        images: pimg ? [pimg] : undefined,
      },
      twitter: {
        card: pimg ? "summary_large_image" : "summary",
        title: ogTitle,
        description: pdesc,
        ...(pimg ? { images: [pimg] } : {}),
      },
      // noindex a draft/archived product or a non-indexable store.
      robots: storeRobots(store as unknown as StoreForSeo, {
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
  const [productResult, themeRaw, catalogue] = await Promise.all([
    fetchProductBySlug(store.id, slug).then(
      (p) => ({ ok: true as const, product: p }),
      (err: unknown) => ({ ok: false as const, error: err }),
    ),
    fetchThemeSettings(store.id).catch(() => null),
    fetchProducts(store.id, 12).catch(() => []),
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

  // JSON-LD for product + breadcrumb. We render the script tag
  // alongside whatever template the store uses (BYOT or built-in)
  // so the structured data is in the rendered HTML regardless of
  // which path renders the page body. Both LDs are emitted as a
  // single script — Google parses each top-level value separately.
  const baseUrl = storeBaseUrl(domain);
  const productLd = product
    ? buildProductLd({ product, baseUrl, storeName: store?.name })
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
    ...ldScripts,
    ...(viewContent ? [viewContent] : []),
  ];

  // BYOT: hand the bundle the page context so it knows to render its
  // product template. Same fork the home route uses.
  if (
    themeSettings.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id)
  ) {
    return (
      <>
        {headExtras}
        <ByotThemeBoundary
          bundleUrl={themeSettings.external_theme.bundle_url}
          cssUrl={themeSettings.external_theme.css_url}
          themeSettings={themeSettings}
          storeData={store}
          page={{
            type: "product",
            title: product?.name,
            handle: slug,
            data: product ? { product, products: catalogue } : undefined,
          }}
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
        />
      </>
    );
  }

  const productTemplate = themeSettings.templates?.product;
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
