import { fetchStoreByDomain, fetchProductBySlug, fetchThemeSettings } from "@/lib/api-client";
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
    return {
      title: `${product?.seo_title || product?.name || "Product"} | ${store?.name || "Store"}`,
      description:
        product?.seo_description || product?.description || "",
      alternates: {
        canonical: `${storeBaseUrl(domain)}/products/${slug}`,
      },
      openGraph: {
        title: product?.name,
        description: product?.description,
        type: "website",
        images: product?.images?.[0]?.url ? [product.images[0].url] : undefined,
      },
    };
  } catch {
    return { title: "Product" };
  }
}

export default async function ProductPage({ params }: PageProps) {
  const { domain, slug } = await params;

  const store = await fetchStoreByDomain(domain);
  const product = await fetchProductBySlug(store.id, slug);
  const themeRaw = await fetchThemeSettings(store.id);
  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});

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

  // BYOT: hand the bundle the page context so it knows to render its
  // product template. Same fork the home route uses.
  if (
    themeSettings.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id)
  ) {
    return (
      <>
        {ldScripts}
        <ByotThemeBoundary
          bundleUrl={themeSettings.external_theme.bundle_url}
          cssUrl={themeSettings.external_theme.css_url}
          themeSettings={themeSettings}
          storeData={store}
          page={{
            type: "product",
            title: product?.name,
            handle: slug,
            data: product ? { product } : undefined,
          }}
        />
      </>
    );
  }

  const productTemplate = themeSettings.templates?.product;
  if (productTemplate) {
    return (
      <>
        {ldScripts}
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
        {ldScripts}
        <div className="max-w-4xl mx-auto p-8 text-center text-gray-500">
          This product is no longer available.
        </div>
      </>
    );
  }
  return (
    <>
      {ldScripts}
      <BuiltInProductDetail
        product={{
          ...product,
          currency: product.currency || store?.currency,
        }}
      />
    </>
  );
}
