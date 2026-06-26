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
    const productActive =
      String(product?.status ?? "active").toLowerCase() === "active";
    return {
      title: ptitle,
      description: pdesc,
      alternates: { canonical },
      openGraph: {
        title: product?.name,
        description: product?.description,
        type: "website",
        url: canonical,
        siteName: store?.name,
        images: pimg ? [pimg] : undefined,
      },
      twitter: {
        card: pimg ? "summary_large_image" : "summary",
        title: product?.name,
        description: product?.description,
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
  let product = null;
  try {
    product = await fetchProductBySlug(store.id, slug);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("API error: 404")) throw err;
  }
  const themeRaw = await fetchThemeSettings(store.id);
  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});

  // Catalogue slice so the bundle's useProducts() has data ON the PDP — the
  // single-product fetch above doesn't populate the catalogue, which left the
  // theme's "you may also like" rail empty. Best-effort; PDP renders without it.
  const catalogue = await fetchProducts(store.id, 12).catch(() => []);

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
  const headExtras = viewContent ? [...ldScripts, viewContent] : ldScripts;

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
