import type { Metadata } from "next";
import { notFound } from "next/navigation";

import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import {
  fetchSeriesBySlug,
  fetchStoreByDomain,
  fetchThemeSettings,
} from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";

interface Props {
  params: Promise<{ domain: string; slug: string }>;
}

async function load(domain: string, slug: string) {
  const store = await fetchStoreByDomain(domain);
  const series = await fetchSeriesBySlug(store.id, slug).catch((error) => {
    if (error instanceof Error && error.message.includes("API error: 404")) return null;
    throw error;
  });
  return { store, series };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { domain, slug } = await params;
  const { store, series } = await load(domain, slug);
  if (!series) return { title: "Series" };
  return {
    title: `${series.name} | ${store.name}`,
    description: series.description || `Read ${series.name} in order.`,
    alternates: { canonical: `/series/${slug}` },
  };
}

export default async function SeriesPage({ params }: Props) {
  const { domain, slug } = await params;
  const { store, series } = await load(domain, slug);
  if (!series) notFound();
  const raw = await fetchThemeSettings(store.id);
  const settings = resolveThemeSettings(raw?.theme_settings || raw || {});

  if (
    settings.external_theme?.bundle_url &&
    !isBuiltInTheme(settings.theme_id)
  ) {
    return (
      <ByotThemeBoundary
        bundleUrl={settings.external_theme.bundle_url}
        cssUrl={settings.external_theme.css_url}
        themeSettings={settings}
        storeData={store}
        page={{ type: "series", title: series.name, handle: slug, data: { series } }}
      />
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="text-4xl font-bold">{series.name}</h1>
      {series.description && <p className="mt-3 text-muted-foreground">{series.description}</p>}
      <ol className="mt-10 grid grid-cols-2 gap-6 md:grid-cols-4">
        {series.products.map((book: Record<string, unknown>) => (
          <li key={String(book.product_id)}>
            <a href={`/products/${String(book.slug)}`} className="block">
              <span className="text-xs uppercase tracking-wide">
                Book {String(book.volume_label || book.position)}
              </span>
              <h2 className="mt-2 font-semibold">{String(book.name)}</h2>
            </a>
          </li>
        ))}
      </ol>
    </main>
  );
}
