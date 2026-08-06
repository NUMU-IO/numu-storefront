/**
 * `/llms.txt` — the plain-text store summary answer engines can actually read.
 *
 * WHY THIS EXISTS
 * A V3 storefront is a BYOT shell: the theme bundle mounts at runtime, so the
 * HTML a non-JS client receives carries almost no catalog text. ChatGPT,
 * Perplexity and Claude never execute JavaScript, so to them a live store with
 * 250 products looks like an empty page — it can be cited for nothing. This
 * route is the one surface they *can* consume: a flat index of the store, its
 * collections, a bounded slice of the catalog, its policy/CMS pages and its
 * public contact details, in the emerging llms.txt shape (an H1 with the name,
 * a one-line blockquote summary, then H2 sections of markdown link lists).
 *
 * WHY IT LIVES AT THE APP ROOT (not under `[domain]/`)
 * Same conclusion as `app/robots.ts`, reached through a different mechanism.
 * `proxy.ts` bypasses the subdomain→path rewrite for anything matching
 * STATIC_FILE_EXT_RE, and that regex includes `.txt` (only `/sitemap.xml` is
 * special-cased back into the tenant rewrite, via TENANT_METADATA_PATHS). So a
 * handler at `[domain]/llms.txt/route.ts` would never be routed on a store
 * host: the request is passed straight through without ever gaining its
 * `/<store>` prefix, and `/llms.txt` would 404 on every production store —
 * exactly the failure `robots.ts` already hit once. At the app root the
 * handler is reached directly and resolves its store from the request host,
 * which is what every other server path in this app does anyway. (Adding
 * `/llms.txt` to TENANT_METADATA_PATHS would also work, but that makes the
 * proxy a registry every static-looking metadata file has to be added to;
 * host resolution needs no such coupling.)
 *
 * CACHING
 * No route-level cache config on purpose: reading `headers()` makes this
 * dynamic, and the freshness comes from the same tag-based revalidation the
 * sitemap relies on. Every fetch below goes through the shared fetchers, which
 * tag their reads `store-{domain}` / `products:{id}` / `categories:{id}` /
 * `blogs-{id}` — the exact tags NUMU-api's `nextjs_revalidation.py` posts to
 * `/api/revalidate` on publish. So a merchant publish refreshes this file the
 * same way it refreshes the sitemap, with the per-fetch ISR window as the net.
 */

import { headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  fetchStoreByDomain,
  fetchProducts,
  fetchCollections,
  fetchStoreMenus,
} from "@/lib/api-client";
import { fetchBlogsList } from "@/lib/blogs";
import { canonicalizeSocialUrl } from "@/lib/json-ld";
import {
  canonicalOriginFor,
  resolveStoreDomainFromHeaders,
  storeBlocksIndexing,
  storeSeoDescription,
  type StoreForSeo,
} from "@/lib/seo";

/**
 * How many products we list. Bounded on purpose: the largest live catalogue is
 * already 250+ SKUs, and every answer engine truncates a long context anyway —
 * an unbounded list would turn a discovery aid into a multi-hundred-KB response
 * regenerated on every crawl. 100 is also `fetchProducts`' single-page size, so
 * the cap costs exactly one upstream request. The file says so out loud (see
 * the "Products" section note) rather than silently pretending it is complete;
 * `/sitemap.xml` remains the exhaustive URL list and is linked below.
 */
const MAX_PRODUCTS = 100;

/** Policy handles `[domain]/policies/[handle]` renders, in the order a
 *  shopper would look for them. Bodies live in `settings.policies`, so we can
 *  only advertise the ones the merchant actually filled in — a link to an
 *  empty policy page is worse than no link for a crawler judging site quality. */
const POLICY_TITLES: Record<string, string> = {
  shipping: "Shipping Policy",
  refund: "Refund Policy",
  terms: "Terms of Service",
  privacy: "Privacy Policy",
};

/** The subset of the public store payload this route reads. `StoreForSeo`
 *  covers the SEO/indexing fields; the contact channels come from
 *  `_serialize_public_store` too but aren't part of that shared shape. */
interface StoreForLlms extends StoreForSeo {
  currency?: string | null;
  country?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  social_links?: Record<string, string> | null;
}

type Loose = Record<string, unknown>;

/**
 * Text fields arrive either as a plain string or as a bilingual `{en, ar}` map
 * depending on which model produced them (products/categories are strings,
 * menu labels and blog titles are maps). Coercing an object with `String()`
 * would publish `[object Object]` into the one file answer engines read, so
 * every value goes through here.
 */
function pickText(value: unknown, lang: string): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const map = value as Record<string, unknown>;
    const first = lang === "ar" ? map.ar : map.en;
    const second = lang === "ar" ? map.en : map.ar;
    if (typeof first === "string" && first.trim()) return first.trim();
    if (typeof second === "string" && second.trim()) return second.trim();
  }
  return "";
}

/** Collapse to a single line and neutralise the two characters that would
 *  break a markdown link out of its own brackets. Merchant copy is free-form
 *  and routinely contains both. */
function mdText(raw: string): string {
  return raw
    .replace(/\s+/g, " ")
    .replace(/([[\]])/g, "\\$1")
    .trim();
}

/**
 * A one-line trailing note for a link ("…): <note>").
 *
 * Collection and blog descriptions come out of a rich-text editor, so they
 * routinely carry markup. Raw `<p>`/`<strong>` in a plain-text file is noise a
 * model has to parse around, and an unclosed tag can swallow the lines after
 * it, so tags are stripped and the result is capped — this file is an index,
 * not a copy of the store's content.
 */
const MAX_NOTE_CHARS = 160;

function note(raw: string): string {
  const text = mdText(raw.replace(/<[^>]*>/g, " "));
  if (text.length <= MAX_NOTE_CHARS) return text;
  return `${text.slice(0, MAX_NOTE_CHARS).trimEnd()}…`;
}

/** `450` not `450.00`, `1499.5` not `1499.50` — the money in this file is read
 *  by a language model, not parsed, so trailing zeros are pure noise. */
function formatPrice(amount: unknown, currency: string): string | null {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n * 100) / 100;
  return `${String(rounded)} ${currency}`;
}

function asArray(value: unknown): Loose[] {
  return Array.isArray(value) ? (value as Loose[]) : [];
}

/**
 * CMS page URLs, harvested from the store's navigation menus.
 *
 * There is no "list all pages" storefront endpoint — `fetchStorePage` resolves
 * one handle at a time — so the menus are the only server-side enumeration of
 * the CMS pages a merchant actually published and linked. That is also the
 * right set to advertise: a page nobody navigates to isn't part of the store's
 * public surface. Returns `{ path → label }`, deduped, nested items included.
 */
function collectPageLinks(
  menus: Record<string, unknown[]>,
  lang: string,
): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (items: unknown[]): void => {
    for (const raw of items) {
      if (!raw || typeof raw !== "object") continue;
      const item = raw as Loose;
      const url = typeof item.url === "string" ? item.url.trim() : "";
      // Relative `/pages/<handle>` only. An absolute URL in a menu points off
      // this store (a merchant's Instagram, a marketplace listing) and must
      // not be presented as part of the store's own page set.
      const match = /^\/pages\/([A-Za-z0-9][A-Za-z0-9-_]*)\/?$/.exec(url);
      if (match) {
        const path = `/pages/${match[1]}`;
        const label = pickText(item.label, lang) || match[1];
        if (!found.has(path)) found.set(path, label);
      }
      if (Array.isArray(item.children)) walk(item.children);
    }
  };
  for (const items of Object.values(menus)) walk(asArray(items));
  return found;
}

/** Public contact channels, exactly as the storefront already shows them —
 *  the merchant's contact email/phone and the social profiles the footer
 *  renders. Nothing here is new disclosure; it is the same data a shopper
 *  reads on the page, restated somewhere a crawler can find it. */
function contactLines(store: StoreForLlms): string[] {
  const lines: string[] = [];
  const email = (store.contact_email ?? "").trim();
  const phone = (store.contact_phone ?? "").trim();
  if (email) lines.push(`- Email: ${mdText(email)}`);
  if (phone) lines.push(`- Phone: ${mdText(phone)}`);
  for (const [platform, value] of Object.entries(store.social_links ?? {})) {
    const url = typeof value === "string" ? value.trim() : "";
    if (!url) continue;
    const name = platform.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    // The Social Links map is free-form and its WhatsApp entry is routinely a
    // bare phone number rather than a URL (see the sameAs note in json-ld.ts),
    // so only http(s) values become links; the rest are stated as plain text.
    //
    // Prefer the canonical profile URL, but fall back to the raw one. Unlike
    // `sameAs`, this file is a reading list rather than an identity claim — a
    // share redirect is still a working link here, so dropping it would lose
    // information for no benefit.
    const clean = canonicalizeSocialUrl(url) ?? url;
    lines.push(
      /^https?:\/\//i.test(clean)
        ? `- [${mdText(name)}](${clean})`
        : `- ${mdText(name)}: ${mdText(clean)}`,
    );
  }
  return lines;
}

function plainText(body: string, status: number): NextResponse {
  return new NextResponse(body, {
    status,
    headers: {
      // charset matters: store names, product titles and policy links are
      // routinely Arabic, and a crawler that guesses latin-1 gets mojibake.
      "Content-Type": "text/plain; charset=utf-8",
      // Only governs downstream caches (Cloudflare, the crawler itself) —
      // server-side freshness is the tag-based revalidation described above.
      // Kept short so a publish isn't shadowed by a long edge TTL.
      "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
    },
  });
}

export async function GET(): Promise<NextResponse> {
  const domain = resolveStoreDomainFromHeaders(await headers());
  if (!domain) return plainText("Not found\n", 404);

  let store: StoreForLlms | null = null;
  try {
    store = (await fetchStoreByDomain(domain)) as unknown as StoreForLlms;
  } catch (err) {
    // Non-fatal but never silent, same rule as the sitemap: a resolver gap
    // that degrades to 404 reads like "this store opted out" rather than
    // "the lookup broke", and nobody would notice for months.
    console.error("[llms.txt] store resolution failed", { domain, err });
    return plainText("Not found\n", 404);
  }
  if (!store?.id) {
    console.error("[llms.txt] store resolved without an id", { domain });
    return plainText("Not found\n", 404);
  }

  // Indexing gate — a suspended / inactive / opted-out store must not hand an
  // answer engine a machine-readable catalogue either. Pairs with robots.ts's
  // `Disallow: /` and the empty sitemap.
  if (storeBlocksIndexing(store)) return plainText("Not found\n", 404);

  const storeId = store.id;
  const origin = canonicalOriginFor(store, domain);
  const lang = (store.default_language ?? "en").toLowerCase().startsWith("ar")
    ? "ar"
    : "en";
  const currency = (store.currency ?? "EGP").toUpperCase();
  const country = (store.country ?? "EG").toUpperCase();
  const name = mdText(store.name ?? "") || domain;

  // Everything is best-effort: a thin llms.txt beats a 500, which crawlers
  // remember far longer than an incomplete file.
  const [products, collections, menus, blogs] = await Promise.all([
    fetchProducts(storeId, MAX_PRODUCTS).catch(() => []),
    fetchCollections(storeId).catch(() => []),
    fetchStoreMenus(storeId).catch(() => ({}) as Record<string, unknown[]>),
    fetchBlogsList(storeId).catch(() => []),
  ]);

  const out: string[] = [];
  out.push(`# ${name}`);
  out.push("");
  out.push(`> ${mdText(storeSeoDescription(store))}`);
  out.push("");
  out.push(
    `Online store on NUMU. Prices are shown in ${currency}; the store ships to ${country}. ` +
      `Every page exists in English and Arabic — prefix any path with \`/ar\` for the Arabic version.`,
  );
  out.push("");

  out.push("## Store");
  out.push(`- [Home](${origin}/): storefront home page`);
  out.push(`- [All products](${origin}/products): full catalogue`);
  out.push(`- [All collections](${origin}/collections): browse by category`);
  // Deliberately no `/search` link: robots.txt disallows it, and pointing an
  // answer engine at a path we've told crawlers to skip is a contradiction
  // they resolve by trusting neither file.
  out.push(`- [Sitemap](${origin}/sitemap.xml): every indexable URL`);
  out.push("");

  const collectionLines: string[] = [];
  for (const c of asArray(collections)) {
    const slug = typeof c.slug === "string" ? c.slug.trim() : "";
    if (!slug) continue;
    const label = mdText(pickText(c.name, lang)) || slug;
    const detail = note(pickText(c.description, lang));
    const url = `${origin}/collections/${encodeURIComponent(slug)}`;
    collectionLines.push(`- [${label}](${url})${detail ? `: ${detail}` : ""}`);
  }
  if (collectionLines.length > 0) {
    out.push("## Collections");
    out.push(...collectionLines);
    out.push("");
  }

  const productList = asArray(products);
  const productLines: string[] = [];
  for (const p of productList) {
    const slug = typeof p.slug === "string" ? p.slug.trim() : "";
    if (!slug) continue;
    const label = mdText(pickText(p.name, lang)) || slug;
    const url = `${origin}/products/${encodeURIComponent(slug)}`;
    const priceCurrency =
      (typeof p.currency === "string" && p.currency.trim()) ||
      (typeof p.price_currency === "string" && p.price_currency.trim()) ||
      currency;
    const price = formatPrice(p.price, priceCurrency.toUpperCase());
    const stock = p.in_stock === false ? "out of stock" : "in stock";
    productLines.push(
      `- [${label}](${url}): ${price ? `${price} — ${stock}` : stock}`,
    );
  }
  if (productLines.length > 0) {
    out.push("## Products");
    if (productLines.length >= MAX_PRODUCTS) {
      out.push(
        `The ${MAX_PRODUCTS} products below are a sample of the catalogue, not the whole of it — ` +
          `see the sitemap above for every product URL.`,
      );
    }
    out.push(...productLines);
    out.push("");
  }

  const blogList = asArray(blogs);
  const blogLines: string[] = [];
  for (const b of blogList) {
    const handle = typeof b.handle === "string" ? b.handle.trim() : "";
    if (!handle) continue;
    const label = mdText(pickText(b.title, lang)) || handle;
    const detail = note(pickText(b.description, lang));
    const url = `${origin}/blogs/${encodeURIComponent(handle)}`;
    blogLines.push(`- [${label}](${url})${detail ? `: ${detail}` : ""}`);
  }
  if (blogLines.length > 0) {
    out.push("## Blog");
    out.push(`- [All articles](${origin}/blogs)`);
    out.push(...blogLines);
    out.push("");
  }

  const pageLinks = collectPageLinks(
    menus as Record<string, unknown[]>,
    lang,
  );
  // `settings` is an untyped merchant-owned blob; a non-object `policies`
  // would make Object.entries below enumerate string indices and emit one
  // bogus link per character.
  const rawPolicies = store.settings?.policies;
  const policies: Record<string, unknown> =
    rawPolicies && typeof rawPolicies === "object" && !Array.isArray(rawPolicies)
      ? (rawPolicies as Record<string, unknown>)
      : {};
  const pageLines: string[] = [];
  for (const [path, label] of pageLinks) {
    pageLines.push(`- [${mdText(label)}](${origin}${path})`);
  }
  // Canonical handles first, in POLICY_TITLES order, then any custom ones the
  // merchant added — so the file's ordering is stable across regenerations
  // rather than following whatever key order the settings blob happens to have.
  const policyHandles = [
    ...Object.keys(POLICY_TITLES).filter((h) => h in policies),
    ...Object.keys(policies).filter((h) => !(h in POLICY_TITLES)),
  ];
  for (const handle of policyHandles) {
    const body = policies[handle];
    if (typeof body !== "string" || !body.trim()) continue;
    const title =
      POLICY_TITLES[handle] ||
      handle.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    pageLines.push(
      `- [${mdText(title)}](${origin}/policies/${encodeURIComponent(handle)})`,
    );
  }
  if (pageLines.length > 0) {
    out.push("## Pages and policies");
    out.push(...pageLines);
    out.push("");
  }

  const contact = contactLines(store);
  if (contact.length > 0) {
    out.push("## Contact");
    out.push(...contact);
    out.push("");
  }

  return plainText(`${out.join("\n").trimEnd()}\n`, 200);
}
