import { loadTemplateContext, getTemplate } from "@/lib/template-page";
import { PageTemplateRenderer } from "@/components/theme-engine/PageTemplateRenderer";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain } = await params;
  try {
    const { store } = await loadTemplateContext(domain);
    return { title: `Forgot password | ${store?.name || "Store"}` };
  } catch {
    return { title: "Forgot password" };
  }
}

export default async function ForgotPasswordPage({ params }: PageProps) {
  const { domain } = await params;
  const ctx = await loadTemplateContext(domain);

  if (ctx.isByot) {
    return (
      <ByotThemeBoundary
        bundleUrl={ctx.themeSettings.external_theme!.bundle_url!}
        cssUrl={ctx.themeSettings.external_theme!.css_url}
        themeSettings={ctx.themeSettings}
        storeData={ctx.store}
        products={ctx.products}
        collections={ctx.collections}
        currentTemplate="forgot-password"
      />
    );
  }

  const template = getTemplate(ctx.themeSettings, "forgot-password");
  if (template) {
    return (
      <PageTemplateRenderer
        template={template}
        themeId={ctx.themeSettings.theme_id}
        storeData={ctx.store}
      />
    );
  }

  return (
    <div className="max-w-md mx-auto p-8">
      <h1 className="text-3xl font-bold">Forgot password</h1>
      <p className="text-gray-500 mt-4">
        The active theme hasn&apos;t defined a forgot-password template yet.
      </p>
    </div>
  );
}
