/**
 * ADR-7 — server-rendered content layer.
 *
 * The host renders a semantic HTML baseline for the PDP / collection / home
 * routes into the INITIAL response, using data the route already fetched. A
 * crawler (or a no-JS visitor) reads it; a real visitor never sees it, because
 * `ByotThemeBoundary` drops it the moment React hydrates — before the theme
 * bundle finishes downloading. Theme code is never executed server-side.
 *
 * Design constraints:
 *   - Correct + semantic, not beautiful. One <h1>, real <a> hrefs, real alt
 *     text, <nav><ol> breadcrumbs, <article> for the product.
 *   - Never throws. Every field is optional; missing description / image /
 *     price / empty lists all degrade to "render less", never to a 500.
 *     Thin content beats a broken page.
 *   - Bilingual EN/AR + RTL, same shape as BuiltInCollectionsIndex.
 *   - Money goes through `@/lib/money` (`formatMajor` — the API's prices are
 *     normalized to MAJOR units at the api-client boundary, see
 *     normalizeProduct; the integer-cents wire format never reaches here).
 *   - No new dependencies. Host design tokens only.
 *
 * These are Server Components: they're passed as an element into the client
 * `ByotThemeBoundary`, so they're rendered on the server and shipped as
 * markup — exactly what the crawler-facing story needs.
 */

import { formatMajor } from "@/lib/money";

// ── loose shapes ────────────────────────────────────────────────────────────
// Deliberately permissive: these render whatever the route fetched, and the
// API's product/collection payloads carry more (and occasionally fewer) keys
// than the strict `@/types` models.

interface ImageLike {
  url?: string | null;
  alt?: string | null;
}

export interface SsrProductLike {
  id?: string;
  name?: string | null;
  title?: string | null;
  slug?: string | null;
  handle?: string | null;
  description?: string | null;
  /** MAJOR units (normalized in api-client). */
  price?: number | null;
  compare_at_price?: number | null;
  currency?: string | null;
  in_stock?: boolean | null;
  is_in_stock?: boolean | null;
  images?: Array<ImageLike | string> | null;
  image_url?: string | null;
  sku?: string | null;
}

export interface SsrCollectionLike {
  id?: string;
  name?: string | null;
  title?: string | null;
  slug?: string | null;
  handle?: string | null;
  description?: string | null;
  image_url?: string | null;
  product_count?: number | null;
}

// ── helpers ─────────────────────────────────────────────────────────────────

const isAr = (locale?: string) => (locale || "en").toLowerCase().startsWith("ar");

/**
 * Product descriptions can be rich text (HTML from the hub editor). We never
 * inject it as markup — strip to plain text so the crawler gets readable prose
 * and no untrusted markup enters the host's DOM.
 */
function toPlainText(html: string | null | undefined, max = 600): string {
  if (!html || typeof html !== "string") return "";
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function imageSrc(img: ImageLike | string | null | undefined): string | null {
  if (!img) return null;
  if (typeof img === "string") return img || null;
  return img.url || null;
}

function productImages(p: SsrProductLike): ImageLike[] {
  const list = Array.isArray(p.images) ? p.images : [];
  const out: ImageLike[] = [];
  for (const raw of list) {
    const url = imageSrc(raw);
    if (!url) continue;
    out.push({ url, alt: typeof raw === "string" ? null : (raw.alt ?? null) });
  }
  if (out.length === 0 && p.image_url) out.push({ url: p.image_url, alt: null });
  return out;
}

/**
 * Mirrors the SDK's `productHref` / `collectionHref`: an entity with no
 * slug must NEVER produce `/products/undefined`. Fall back to the id, then
 * to the index route.
 */
export function productHref(p: SsrProductLike): string {
  const key = p.slug || p.handle || p.id;
  return key ? `/products/${encodeURIComponent(String(key))}` : "/products";
}

export function collectionHref(c: SsrCollectionLike): string {
  const key = c.slug || c.handle || c.id;
  return key ? `/collections/${encodeURIComponent(String(key))}` : "/collections";
}

const nameOf = (e: { name?: string | null; title?: string | null }): string =>
  (e.name || e.title || "").trim();

/** Price line for a product, or null when the product carries no usable price. */
function priceText(p: SsrProductLike, fallbackCurrency?: string): string | null {
  const value = typeof p.price === "number" && Number.isFinite(p.price) ? p.price : null;
  if (value === null) return null;
  return formatMajor(value, p.currency || fallbackCurrency || "EGP");
}

function compareAtText(
  p: SsrProductLike,
  fallbackCurrency?: string,
): string | null {
  const price = typeof p.price === "number" ? p.price : null;
  const compare =
    typeof p.compare_at_price === "number" && Number.isFinite(p.compare_at_price)
      ? p.compare_at_price
      : null;
  if (price === null || compare === null || compare <= price) return null;
  return formatMajor(compare, p.currency || fallbackCurrency || "EGP");
}

const wrapClass =
  "mx-auto max-w-6xl px-4 py-8 [font-family:var(--numu-sans)] text-[var(--numu-ink)]";
const mutedClass = "text-sm text-[var(--numu-ink-soft)]";

function copy(locale?: string) {
  const ar = isAr(locale);
  return {
    ar,
    dir: ar ? ("rtl" as const) : ("ltr" as const),
    home: ar ? "الرئيسية" : "Home",
    products: ar ? "كل المنتجات" : "All products",
    collections: ar ? "كل المجموعات" : "All collections",
    breadcrumb: ar ? "مسار التنقل" : "Breadcrumb",
    inStock: ar ? "متوفر" : "In stock",
    outOfStock: ar ? "غير متوفر" : "Out of stock",
    was: ar ? "بدلاً من" : "was",
    noProducts: ar ? "لا توجد منتجات في هذه المجموعة حالياً." : "No products in this collection yet.",
    shop: ar ? "تسوق" : "Shop",
    view: (name: string) => (ar ? `عرض ${name}` : `View ${name}`),
    // Arabic pluralises in four buckets, not two. `${n} منتج` for every n
    // reads as broken Arabic to a native speaker — and this string is
    // crawler-facing in an Arabic-first market, so it is worth getting right:
    //   1 → منتج (singular) · 2 → منتجين (dual) · 3-10 → منتجات (plural)
    //   11+ → منتج (singular again, after the number)
    count: (n: number) => {
      if (!ar) return `${n} ${n === 1 ? "product" : "products"}`;
      if (n === 1) return "منتج واحد";
      if (n === 2) return "منتجان";
      if (n >= 3 && n <= 10) return `${n} منتجات`;
      return `${n} منتج`;
    },
  };
}

/** Breadcrumb trail: real <nav><ol> with real links. */
function Breadcrumbs({
  trail,
  label,
}: {
  trail: Array<{ name: string; href?: string }>;
  label: string;
}) {
  const items = trail.filter((t) => t.name);
  if (items.length === 0) return null;
  return (
    <nav aria-label={label} className={`mb-4 ${mutedClass}`}>
      <ol className="flex flex-wrap items-center gap-x-2">
        {items.map((item, i) => (
          <li key={`${item.name}-${i}`} className="flex items-center gap-x-2">
            {item.href ? (
              <a href={item.href} className="underline underline-offset-2">
                {item.name}
              </a>
            ) : (
              <span aria-current="page">{item.name}</span>
            )}
            {i < items.length - 1 && <span aria-hidden="true">/</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ── PDP ─────────────────────────────────────────────────────────────────────

export function SsrProductContent({
  product,
  storeName,
  storeCurrency,
  locale,
}: {
  product: SsrProductLike | null | undefined;
  storeName?: string | null;
  storeCurrency?: string | null;
  locale?: string;
}) {
  if (!product) return null;
  const t = copy(locale);
  const title = nameOf(product) || (t.ar ? "منتج" : "Product");
  const description = toPlainText(product.description);
  const price = priceText(product, storeCurrency || undefined);
  const compareAt = compareAtText(product, storeCurrency || undefined);
  const images = productImages(product).slice(0, 5);
  const inStock = product.in_stock ?? product.is_in_stock ?? true;

  return (
    <div dir={t.dir} className={wrapClass}>
      <Breadcrumbs
        label={t.breadcrumb}
        trail={[
          { name: storeName || t.home, href: "/" },
          { name: t.products, href: "/products" },
          { name: title },
        ]}
      />
      <article>
        <h1 className="text-2xl font-bold [font-family:var(--numu-display)]">
          {title}
        </h1>

        <p className="mt-2 text-lg font-semibold">
          {price ?? ""}
          {compareAt && (
            <span className={`ms-2 font-normal ${mutedClass}`}>
              {t.was} <s>{compareAt}</s>
            </span>
          )}
        </p>

        <p className={`mt-1 ${mutedClass}`}>
          {inStock ? t.inStock : t.outOfStock}
        </p>

        {description && (
          <div className="mt-4 max-w-2xl whitespace-pre-line leading-relaxed">
            {description}
          </div>
        )}

        {images.length > 0 && (
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {images.map((img, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={`${img.url}-${i}`}
                src={img.url as string}
                alt={
                  img.alt ||
                  (t.ar
                    ? `${title} — صورة ${i + 1}`
                    : `${title} — image ${i + 1}`)
                }
                loading="lazy"
                className="h-auto w-full rounded-[var(--numu-radius)] object-cover"
              />
            ))}
          </div>
        )}
      </article>
    </div>
  );
}

// ── Collection ──────────────────────────────────────────────────────────────

export function SsrCollectionContent({
  collection,
  products,
  storeName,
  storeCurrency,
  locale,
}: {
  collection: SsrCollectionLike | null | undefined;
  products: SsrProductLike[] | null | undefined;
  storeName?: string | null;
  storeCurrency?: string | null;
  locale?: string;
}) {
  const t = copy(locale);
  const list = Array.isArray(products) ? products : [];
  const title =
    (collection ? nameOf(collection) : "") || (t.ar ? "مجموعة" : "Collection");
  const description = toPlainText(collection?.description, 400);

  return (
    <div dir={t.dir} className={wrapClass}>
      <Breadcrumbs
        label={t.breadcrumb}
        trail={[
          { name: storeName || t.home, href: "/" },
          { name: t.collections, href: "/collections" },
          { name: title },
        ]}
      />
      <h1 className="text-2xl font-bold [font-family:var(--numu-display)]">
        {title}
      </h1>
      {description && <p className="mt-2 max-w-2xl">{description}</p>}
      <p className={`mt-1 ${mutedClass}`}>{t.count(list.length)}</p>

      {list.length === 0 ? (
        <p className="mt-6">
          {t.noProducts}{" "}
          <a href="/products" className="underline underline-offset-2">
            {t.products}
          </a>
        </p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {list.slice(0, 60).map((p, i) => {
            const name = nameOf(p) || (t.ar ? "منتج" : "Product");
            const img = productImages(p)[0];
            const price = priceText(p, storeCurrency || undefined);
            return (
              <li key={p.id || p.slug || `${name}-${i}`}>
                <a href={productHref(p)} className="block">
                  {img?.url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img.url}
                      alt={img.alt || name}
                      loading="lazy"
                      className="mb-2 aspect-square w-full rounded-[var(--numu-radius)] object-cover"
                    />
                  )}
                  <h2 className="text-sm font-medium">{name}</h2>
                  {price && <p className={mutedClass}>{price}</p>}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ── Home ────────────────────────────────────────────────────────────────────

export function SsrHomeContent({
  storeName,
  storeDescription,
  collections,
  products,
  storeCurrency,
  locale,
}: {
  storeName?: string | null;
  storeDescription?: string | null;
  collections?: SsrCollectionLike[] | null;
  products?: SsrProductLike[] | null;
  storeCurrency?: string | null;
  locale?: string;
}) {
  const t = copy(locale);
  const title = (storeName || "").trim() || (t.ar ? "المتجر" : "Store");
  const description = toPlainText(storeDescription, 400);
  const cols = (Array.isArray(collections) ? collections : []).slice(0, 24);
  const prods = (Array.isArray(products) ? products : []).slice(0, 24);

  return (
    <div dir={t.dir} className={wrapClass}>
      <h1 className="text-2xl font-bold [font-family:var(--numu-display)]">
        {title}
      </h1>
      {description && <p className="mt-2 max-w-2xl">{description}</p>}

      {cols.length > 0 && (
        <nav aria-label={t.collections} className="mt-8">
          <h2 className="text-lg font-semibold">{t.collections}</h2>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
            {cols.map((c, i) => {
              const name = nameOf(c);
              if (!name) return null;
              return (
                <li key={c.id || c.slug || `${name}-${i}`}>
                  <a
                    href={collectionHref(c)}
                    className="underline underline-offset-2"
                  >
                    {name}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {prods.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">{t.shop}</h2>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
            {prods.map((p, i) => {
              const name = nameOf(p) || (t.ar ? "منتج" : "Product");
              const price = priceText(p, storeCurrency || undefined);
              return (
                <li key={p.id || p.slug || `${name}-${i}`}>
                  <a href={productHref(p)} className="underline underline-offset-2">
                    {name}
                  </a>
                  {price && <span className={`ms-2 ${mutedClass}`}>{price}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {cols.length === 0 && prods.length === 0 && (
        <p className="mt-6">
          <a href="/products" className="underline underline-offset-2">
            {t.products}
          </a>
        </p>
      )}
    </div>
  );
}
