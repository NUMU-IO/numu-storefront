import { loadTemplateContext, getTemplate } from "@/lib/template-page";
import { PageTemplateRenderer } from "@/components/theme-engine/PageTemplateRenderer";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";

interface PageProps {
  params: Promise<{ domain: string }>;
}

export default async function HomePage({ params }: PageProps) {
  const { domain } = await params;
  const ctx = await loadTemplateContext(domain);

  // BYOT — render the theme bundle client-side. Catalog is forwarded so
  // theme sections that call useProducts() / useCollections() see real
  // data without each section round-tripping the API.
  if (ctx.isByot) {
    return (
      <ByotThemeBoundary
        bundleUrl={ctx.themeSettings.external_theme!.bundle_url!}
        cssUrl={ctx.themeSettings.external_theme!.css_url}
        themeSettings={ctx.themeSettings}
        storeData={ctx.store}
        products={ctx.products}
        collections={ctx.collections}
        currentTemplate="home"
      />
    );
  }

  // Built-in: render server-side
  const homeTemplate = getTemplate(ctx.themeSettings, "home");
  if (!homeTemplate) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        No home template configured
      </div>
    );
  }

  return (
    <PageTemplateRenderer
      template={homeTemplate}
      themeId={ctx.themeSettings.theme_id}
      storeData={ctx.store}
    />
  );
}
