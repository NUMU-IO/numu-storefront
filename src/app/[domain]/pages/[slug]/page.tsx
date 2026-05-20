import { loadTemplateContext, getTemplate } from "@/lib/template-page";
import { PageTemplateRenderer } from "@/components/theme-engine/PageTemplateRenderer";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import type { Metadata } from "next";

/**
 * CMS page route — /[domain]/pages/[slug]. Renders the merchant's
 * static content (about / contact / FAQ / shipping / etc.) via the
 * theme's `page` template. The slug is forwarded to the bundle so a
 * theme that wants to vary content by slug (e.g. an FAQ section
 * keyed off the page) can do so.
 */

interface PageProps {
  params: Promise<{ domain: string; slug: string }>;
}

function prettyTitle(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain, slug } = await params;
  try {
    const { store } = await loadTemplateContext(domain);
    return { title: `${prettyTitle(slug)} | ${store?.name || "Store"}` };
  } catch {
    return { title: prettyTitle(slug) };
  }
}

export default async function CmsPage({ params }: PageProps) {
  const { domain, slug } = await params;
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
        currentTemplate="page"
        // Slug surfaced via currentProduct slot for now — the bundle's
        // mount contract has no dedicated `currentPage` channel yet, and
        // re-using an existing slot avoids a breaking SDK change. Themes
        // that care about the page slug can read it from window.location
        // or from a future `currentPage` extension.
      />
    );
  }

  const template = getTemplate(ctx.themeSettings, "page");
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
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold">{prettyTitle(slug)}</h1>
      <p className="text-gray-500 mt-4">
        The active theme hasn&apos;t defined a page template yet.
      </p>
    </div>
  );
}
