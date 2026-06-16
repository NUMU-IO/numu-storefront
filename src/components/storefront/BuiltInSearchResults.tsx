"use client";

/**
 * Built-in search-results page — the ENG-2 no-blank backstop for the
 * /search route. Used when a BYOT bundle ships no `search` template (most
 * themes don't) so the bundle renders an empty wrapper. Self-contained, no
 * SDK context — same shape as BuiltInCart / BuiltInProductDetail.
 *
 * The /search route already pre-fetches the store's product slice and passes
 * it here, so filtering is free (no extra request): we match the query against
 * product name + description client-side, exactly the contract the route's
 * doc-comment describes for theme search sections. A live search box lets the
 * shopper refine without a round-trip.
 */

import { useMemo, useState } from "react";
import { formatMajor } from "@/lib/money";

interface ProductLike {
  id?: string;
  slug?: string;
  handle?: string;
  name?: string;
  title?: string;
  description?: string;
  price?: number;
  compare_at_price?: number;
  currency?: string;
  in_stock?: boolean;
  images?: Array<{ url?: string } | string> | null;
}

interface Props {
  products: ProductLike[];
  query?: string;
  storeCurrency?: string;
  /** Visitor locale ("ar" → Arabic + RTL). */
  locale?: string;
}

function imageUrl(p: ProductLike): string | null {
  const first = Array.isArray(p.images) ? p.images[0] : null;
  if (!first) return null;
  return typeof first === "string" ? first : first.url ?? null;
}

function productHref(p: ProductLike): string {
  return `/products/${encodeURIComponent(p.slug || p.handle || p.id || "")}`;
}

function matches(p: ProductLike, q: string): boolean {
  if (!q) return true;
  const hay = `${p.name ?? p.title ?? ""} ${p.description ?? ""}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}

export default function BuiltInSearchResults({
  products,
  query = "",
  storeCurrency = "EGP",
  locale = "en",
}: Props) {
  const ar = locale === "ar";
  const [q, setQ] = useState(query);

  const results = useMemo(
    () => (Array.isArray(products) ? products.filter((p) => matches(p, q.trim())) : []),
    [products, q],
  );

  const t = {
    title: ar ? "نتائج البحث" : "Search",
    placeholder: ar ? "ابحث عن المنتجات…" : "Search products…",
    count: (n: number) =>
      ar
        ? `${n} ${n === 1 ? "نتيجة" : "نتيجة"}`
        : `${n} ${n === 1 ? "result" : "results"}`,
    empty: ar
      ? q
        ? `لا توجد نتائج لـ "${q}".`
        : "اكتب كلمة للبحث عن المنتجات."
      : q
        ? `No results for "${q}".`
        : "Type a term to search products.",
    soldOut: ar ? "نفدت الكمية" : "Sold out",
  };

  return (
    <main
      dir={ar ? "rtl" : "ltr"}
      className="max-w-6xl mx-auto px-4 py-10"
    >
      <h1 className="text-2xl font-bold mb-4">{t.title}</h1>

      <div className="mb-6 max-w-md">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.placeholder}
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm outline-none focus:border-gray-900"
          aria-label={t.placeholder}
        />
      </div>

      <p className="text-sm text-gray-500 mb-6">{t.count(results.length)}</p>

      {results.length === 0 ? (
        <p className="text-gray-600">{t.empty}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-8">
          {results.map((p) => {
            const img = imageUrl(p);
            const ccy = p.currency || storeCurrency;
            const onSale =
              typeof p.compare_at_price === "number" &&
              typeof p.price === "number" &&
              p.compare_at_price > p.price;
            return (
              <a
                key={p.id || p.slug || p.handle}
                href={productHref(p)}
                className="group block"
              >
                <div className="aspect-square w-full overflow-hidden rounded-lg bg-gray-100">
                  {img ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={img}
                      alt={p.name ?? p.title ?? ""}
                      className="h-full w-full object-cover transition group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-full w-full" />
                  )}
                </div>
                <h3 className="mt-2 text-sm font-medium text-gray-900 line-clamp-2">
                  {p.name ?? p.title ?? ""}
                </h3>
                <div className="mt-1 flex items-center gap-2 text-sm">
                  {typeof p.price === "number" && (
                    <span className="font-semibold">
                      {formatMajor(p.price, ccy)}
                    </span>
                  )}
                  {onSale && (
                    <span className="text-gray-400 line-through">
                      {formatMajor(p.compare_at_price as number, ccy)}
                    </span>
                  )}
                </div>
                {p.in_stock === false && (
                  <span className="mt-1 inline-block text-xs text-gray-400">
                    {t.soldOut}
                  </span>
                )}
              </a>
            );
          })}
        </div>
      )}
    </main>
  );
}
