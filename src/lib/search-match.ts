/**
 * The one product/query match behind `/search`: the count sent with the search
 * funnel event (`results_count`, read by the hub's "searches with no results"),
 * the no-JS `SsrSearchContent` layer and the `BuiltInSearchResults` backstop.
 * One function, so the three never disagree again.
 *
 * Wide on purpose. Themes run their own match over the same prefetched rows,
 * on a subset of these fields (vionne and luxury-minimal: name, description,
 * tags; genova and powells: the SDK's `useSearch`). The count must never say 0
 * while the shopper is looking at results, so it matches on everything a theme
 * might: name, description, SKU, tags, and the Arabic name and description the
 * product carries under `attributes`.
 *
 * Known limit: this is the host's match over at most the 1,000 products the
 * route prefetches, not the theme's own list. It answers "did anything match?",
 * which is what `zero_result_searches` needs. Exact per-theme counts come with
 * the Smart Search app.
 */
export interface SearchableProduct {
  name?: string | null;
  title?: string | null;
  description?: string | null;
  sku?: string | null;
  tags?: unknown;
  attributes?: unknown;
}

function arabicCopy(attributes: unknown): string {
  if (!attributes || typeof attributes !== "object") return "";
  const a = attributes as Record<string, unknown>;
  return [a.nameAr, a.descriptionAr].filter((v) => typeof v === "string").join(" ");
}

export function matchesQuery(p: SearchableProduct, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return false;
  // Starts with the old `name description` haystack, so everything the old
  // match found is still found.
  const tags = Array.isArray(p.tags) ? p.tags.filter((t) => typeof t === "string").join(" ") : "";
  const hay = `${p.name ?? p.title ?? ""} ${p.description ?? ""} ${p.sku ?? ""} ${tags} ${arabicCopy(p.attributes)}`;
  return hay.toLowerCase().includes(needle);
}
