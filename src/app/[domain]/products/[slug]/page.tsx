import { fetchStoreByDomain, fetchProductBySlug, fetchThemeSettings } from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { PageTemplateRenderer } from "@/components/theme-engine/PageTemplateRenderer";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string; slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain, slug } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    const product = await fetchProductBySlug(store.id, slug);
    return {
      title: `${product?.name || "Product"} | ${store?.name || "Store"}`,
      description: product?.description || "",
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

  const productTemplate = themeSettings.templates?.product;
  if (productTemplate) {
    return (
      <PageTemplateRenderer
        template={productTemplate}
        themeId={themeSettings.theme_id}
        storeData={store}
      />
    );
  }

  // Fallback product page
  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold">{product?.name || "Product"}</h1>
      <p className="text-gray-600 mt-4">{product?.description || ""}</p>
      <p className="text-2xl font-bold mt-4">{product?.price || 0} {product?.currency || store?.currency}</p>
    </div>
  );
}
