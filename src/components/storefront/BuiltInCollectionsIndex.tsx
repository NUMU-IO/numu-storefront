"use client";

/**
 * Built-in collections-index page — the ENG-2 no-blank backstop for
 * `/collections`.
 *
 * Why this exists: the collections INDEX is selected by `page.type =
 * "collections"`, which resolves to a `collections` template inside the
 * bundle. Exactly ONE of the sixteen V3 themes ships that template
 * (vionne) — the other fifteen, including bazar (which runs a live
 * production store), have no `collections` entry in their presets. A theme
 * with no matching template renders an empty wrapper, and because these
 * themes carry their header/footer INLINE in each template's section list
 * (rather than in `section_groups`), an absent template means no chrome
 * either: the route came out completely blank — no nav, no footer, no
 * content, no error.
 *
 * That route is not obscure. It is what the header's "All collections" link
 * and the mobile drawer point at.
 *
 * Sibling of BuiltInCart / BuiltInSearchResults: self-contained, no SDK
 * context, bilingual + RTL, uses the host's own design tokens.
 */

interface CollectionLike {
  id?: string;
  slug?: string;
  handle?: string;
  name?: string;
  title?: string;
  name_i18n?: Record<string, string> | null;
  description?: string;
  image?: string | { url?: string } | null;
  image_url?: string | null;
  product_count?: number;
  products_count?: number;
}

interface Props {
  collections: CollectionLike[];
  storeName?: string;
  /** Visitor locale ("ar" → Arabic + RTL). */
  locale?: string;
}

function imageUrl(c: CollectionLike): string | null {
  if (typeof c.image === "string") return c.image;
  if (c.image && typeof c.image === "object" && c.image.url) return c.image.url;
  return c.image_url ?? null;
}

/**
 * Mirrors the SDK's `collectionHref`: a slugless category must never produce
 * `/collections/undefined` (the exact live bug the route primitive was
 * extracted to kill), so fall back to the id.
 */
function collectionHref(c: CollectionLike): string {
  const key = c.slug || c.handle || c.id;
  return key ? `/collections/${encodeURIComponent(key)}` : "/products";
}

function label(c: CollectionLike, locale: string): string {
  return c.name_i18n?.[locale] || c.name || c.title || "";
}

export default function BuiltInCollectionsIndex({
  collections,
  storeName,
  locale = "en",
}: Props) {
  const ar = locale === "ar";
  const list = Array.isArray(collections) ? collections : [];

  const t = {
    title: ar ? "كل المجموعات" : "All collections",
    subtitle: ar
      ? `تصفّح كل مجموعات ${storeName || "المتجر"}.`
      : `Browse every collection from ${storeName || "the store"}.`,
    empty: ar
      ? "لسه مفيش مجموعات هنا. تقدر تتصفح كل المنتجات."
      : "No collections yet. Browse all products instead.",
    allProducts: ar ? "كل المنتجات" : "All products",
    count: (n: number) =>
      ar ? `${n} ${n === 1 ? "منتج" : "منتج"}` : `${n} ${n === 1 ? "product" : "products"}`,
  };

  return (
    <main
      dir={ar ? "rtl" : "ltr"}
      className="mx-auto max-w-6xl px-4 py-10 [font-family:var(--numu-sans)]"
    >
      <h1 className="mb-2 text-2xl font-bold text-[var(--numu-ink)] [font-family:var(--numu-display)]">
        {t.title}
      </h1>
      <p className="mb-8 text-sm text-[var(--numu-ink-soft)]">{t.subtitle}</p>

      {list.length === 0 ? (
        <div className="space-y-4">
          <p className="text-[var(--numu-ink-soft)]">{t.empty}</p>
          <a
            href="/products"
            className="inline-block rounded-[var(--numu-radius)] border border-[var(--numu-border)] px-4 py-2 text-sm text-[var(--numu-ink)] transition-colors hover:border-[var(--numu-navy)]"
          >
            {t.allProducts}
          </a>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((c) => {
            const img = imageUrl(c);
            const count = c.product_count ?? c.products_count;
            return (
              <a
                key={c.id || c.slug || c.handle}
                href={collectionHref(c)}
                className="group block"
              >
                <div className="aspect-square w-full overflow-hidden rounded-[var(--numu-radius)] border border-[var(--numu-border)] bg-[var(--numu-cream)]">
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img}
                      alt={label(c, locale)}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-full w-full" />
                  )}
                </div>
                <h2 className="mt-2 line-clamp-2 text-sm font-medium text-[var(--numu-ink)]">
                  {label(c, locale)}
                </h2>
                {typeof count === "number" && (
                  <p className="mt-0.5 text-xs text-[var(--numu-ink-soft)]">
                    {t.count(count)}
                  </p>
                )}
              </a>
            );
          })}
        </div>
      )}
    </main>
  );
}
