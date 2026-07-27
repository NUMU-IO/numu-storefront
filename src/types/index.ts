// V3 Theme Settings Types (mirrors backend ThemeSettingsV3)

export interface ThemeSettingsV3 {
  schema_version: 3;
  theme_id: string;
  global_settings: Record<string, any>;
  templates: Record<string, PageTemplate>;
  section_groups: Record<string, SectionGroup>;
  external_theme?: ExternalThemeMetadata | null;
}

export interface PageTemplate {
  name: string;
  sections: Record<string, SectionInstance>;
  order: string[];
}

export interface SectionGroup {
  name: string;
  sections: Record<string, SectionInstance>;
  order: string[];
}

export interface SectionInstance {
  type: string;
  settings: Record<string, any>;
  disabled?: boolean;
  blocks?: Record<string, BlockInstance>;
  block_order?: string[];
}

export interface BlockInstance {
  type: string;
  settings: Record<string, any>;
  disabled?: boolean;
}

export interface ExternalThemeMetadata {
  bundle_url: string;
  css_url?: string | null;
  /**
   * SHA-256 hex digest of the published bundle, set at activation from
   * `marketplace_theme_versions.checksum`. When present the loader verifies
   * the fetched bytes before evaluating them, so a bundle swapped at the CDN
   * after review fails closed. Absent for dev-mode bundles (a live Vite
   * server's bytes change on every save) — then the host allowlist is the
   * only gate.
   */
  checksum?: string | null;
  mode?: string;
  settings_schema?: Record<string, any> | null;
  section_schemas?: Record<string, any> | null;
  /**
   * Preset templates declared in the theme's `theme.json.presets.templates`.
   * Used as a fallback when the saved customization's templates are stripped
   * empty (e.g. all sections were from a previously-active theme and don't
   * exist in the new bundle's section registry).
   */
  presets?: Record<string, any> | null;
  /** Theme id from the manifest, used to detect theme switches. */
  theme_id?: string | null;
}

// Store data from API
export interface StoreData {
  id: string;
  name: string;
  slug: string;
  domain?: string;
  subdomain?: string;
  logo_url?: string;
  description?: string;
  /**
   * Capture currency, normalized from the API's `default_currency` at the
   * fetch boundary (see normalizeStore in api-client). The app reads this
   * field; the backend never sends a bare `currency`.
   */
  currency: string;
  /** ISO 3166-1 alpha-2 market code (e.g. "EG", "SA"). */
  country?: string;
  default_language: string;
  use_nextjs_storefront: boolean;
  /**
   * Platform → URL/handle map the merchant sets in the customizer's Social
   * Links panel (e.g. `{ whatsapp: "https://wa.me/2010…", instagram: "…" }`).
   * Returned by `_serialize_public_store`; drives the footer social icons and
   * the host-shell WhatsApp float.
   */
  social_links?: Record<string, string> | null;
}

// Product types
export interface Product {
  id: string;
  name: string;
  slug: string;
  description?: string;
  price: number;
  compare_at_price?: number;
  currency: string;
  images: ProductImage[];
  variants: ProductVariant[];
  category?: string;
  tags?: string[];
  in_stock: boolean;
  /** Alternate template variant key suffix (e.g. "wholesale" → template
   *  `product.wholesale`); null/undefined = the base `product` template. */
  template_suffix?: string | null;
}

export interface ProductImage {
  id: string;
  url: string;
  alt?: string;
  position: number;
}

export interface ProductVariant {
  id: string;
  name: string;
  price: number;
  sku?: string;
  in_stock: boolean;
  options: Record<string, string>;
}

export interface Collection {
  id: string;
  name: string;
  slug: string;
  description?: string;
  image_url?: string;
  product_count: number;
}

// Section component props
export interface SectionProps {
  settings: Record<string, any>;
  blocks?: Record<string, BlockInstance>;
  blockOrder?: string[];
  storeData?: StoreData;
}

export interface BlockProps {
  settings: Record<string, any>;
}

/**
 * The page descriptor handed to a theme bundle's mount ctx — which template
 * to render and the data for it.
 *
 * Lives here (not in `ByotThemeBoundary`) because BOTH render paths need it:
 * the client boundary and the server-side SSR request builder
 * (`lib/ssr-theme-request.ts`). The two must pass the SAME descriptor or
 * hydration mismatches, so they share one type.
 */
export interface PageContextData {
  /** "home" | "product" | "collection" | "cart" | "page" | "404" | … */
  type: string;
  title?: string;
  handle?: string;
  data?: Record<string, unknown>;
}

// API response wrapper
export interface ThemeResolutionResponse {
  store: StoreData;
  theme_settings: Record<string, any>;
  products?: Product[];
  collections?: Collection[];
}
