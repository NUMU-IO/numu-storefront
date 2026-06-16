/**
 * Shared SEO helpers for the V3 storefront host — the global metadata defaults
 * + the store-status/indexing gate that V2 had (numu-egyptian-bazaar's
 * seo-server.ts) and V3 had lost.
 *
 * The gate keys off two fields the backend already exposes on the public store
 * payload (`_serialize_public_store`): `status` (active/inactive/suspended/
 * pending_approval) and `seo.robots_indexing_enabled`. A suspended or
 * merchant-opted-out store must NOT be crawlable.
 */

import type { Metadata } from "next";

const PLATFORM_DOMAIN = process.env.NUMU_PLATFORM_DOMAIN || "numueg.app";
const IS_PROD = process.env.NEXT_PUBLIC_NUMU_ENV === "production";

/** Loose store shape — the host's StoreData doesn't type these fields, but the
 *  backend sends them. Optional throughout; we narrow defensively. */
export interface StoreForSeo {
  id?: string;
  name?: string | null;
  subdomain?: string | null;
  custom_domain?: string | null;
  description?: string | null;
  default_language?: string | null;
  logo_url?: string | null;
  banner_url?: string | null;
  status?: string | null;
  seo?: {
    seo_title?: string | null;
    seo_description?: string | null;
    social_image_url?: string | null;
    robots_indexing_enabled?: boolean | null;
    google_site_verification?: string | null;
    bing_site_verification?: string | null;
  } | null;
  settings?: Record<string, unknown> | null;
  theme_settings?: Record<string, unknown> | null;
}

export const NOINDEX_ROBOTS: Metadata["robots"] = {
  index: false,
  follow: false,
  nocache: true,
  googleBot: { index: false, follow: false },
};

const INDEX_ROBOTS: Metadata["robots"] = {
  index: true,
  follow: true,
  googleBot: {
    index: true,
    follow: true,
    "max-image-preview": "large",
    "max-snippet": -1,
    "max-video-preview": -1,
  },
};

/** True when the store must NOT be indexed (suspended/inactive/pending, or the
 *  merchant flipped indexing off). A null store also blocks. */
export function storeBlocksIndexing(store: StoreForSeo | null | undefined): boolean {
  if (!store) return true;
  const status = (store.status ?? "").toLowerCase();
  if (status && status !== "active") return true;
  if (store.seo?.robots_indexing_enabled === false) return true;
  return false;
}

export function storeRobots(
  store: StoreForSeo | null | undefined,
  opts: { forceNoindex?: boolean } = {},
): Metadata["robots"] {
  if (opts.forceNoindex || storeBlocksIndexing(store)) return NOINDEX_ROBOTS;
  return INDEX_ROBOTS;
}

/** Canonical origin: custom domain › subdomain in prod; path-segment in dev. */
export function canonicalOriginFor(
  store: StoreForSeo | null | undefined,
  domain: string,
): string {
  if (IS_PROD) {
    const custom = (store?.custom_domain ?? "").trim();
    if (custom) return `https://${custom}`;
    const sub = (store?.subdomain ?? "").trim() || domain;
    return `https://${sub}.${PLATFORM_DOMAIN}`;
  }
  return `http://localhost:3100/${domain}`;
}

export function storeSeoTitle(store: StoreForSeo | null | undefined): string {
  return (store?.seo?.seo_title || store?.name || "NUMU Store").trim();
}

export function storeSeoDescription(store: StoreForSeo | null | undefined): string {
  const explicit = (store?.seo?.seo_description ?? "").trim();
  if (explicit) return explicit;
  const desc = (store?.description ?? "").trim();
  if (desc) return desc;
  const name = (store?.name ?? "").trim() || "NUMU";
  const ar = (store?.default_language ?? "").toLowerCase() === "ar";
  return ar
    ? `تسوّق من ${name} — تشكيلة مختارة وتوصيل لكل محافظات مصر، والدفع عند الاستلام متاح.`
    : `Shop ${name} — a curated selection with shipping across Egypt. Cash on delivery available.`;
}

export function storeSocialImage(store: StoreForSeo | null | undefined): string | null {
  const s = (store?.seo?.social_image_url ?? "").trim();
  if (s) return s;
  const b = (store?.banner_url ?? "").trim();
  if (b) return b;
  const l = (store?.logo_url ?? "").trim();
  return l || null;
}

function ogLocale(store: StoreForSeo | null | undefined): string {
  return (store?.default_language ?? "").toLowerCase() === "ar" ? "ar_EG" : "en_EG";
}

export function buildOpenGraph(
  store: StoreForSeo | null | undefined,
  opts: {
    title: string;
    description: string;
    url: string;
    image?: string | null;
    type?: "website" | "article";
  },
): NonNullable<Metadata["openGraph"]> {
  const og: NonNullable<Metadata["openGraph"]> = {
    title: opts.title,
    description: opts.description,
    type: opts.type ?? "website",
    url: opts.url,
    siteName: store?.name || "NUMU Store",
    locale: ogLocale(store),
  };
  if (opts.image) {
    og.images = [{ url: opts.image, alt: opts.title, width: 1200, height: 630 }];
  }
  return og;
}

export function buildTwitter(opts: {
  title: string;
  description: string;
  image?: string | null;
}): NonNullable<Metadata["twitter"]> {
  return {
    card: opts.image ? "summary_large_image" : "summary",
    title: opts.title,
    description: opts.description,
    ...(opts.image ? { images: [opts.image] } : {}),
  };
}
