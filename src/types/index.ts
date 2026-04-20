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
  mode?: string;
  settings_schema?: Record<string, any> | null;
  section_schemas?: Record<string, any> | null;
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
  currency: string;
  default_language: string;
  use_nextjs_storefront: boolean;
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

// API response wrapper
export interface ThemeResolutionResponse {
  store: StoreData;
  theme_settings: Record<string, any>;
  products?: Product[];
  collections?: Collection[];
}
