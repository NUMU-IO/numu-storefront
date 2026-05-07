import type { ThemeSettingsV3, SectionGroup, SectionInstance, PageTemplate } from "@/types";

/**
 * Dual-Read normalization: converts V1/V2 legacy payloads to V3 in memory.
 * This ensures the Next.js storefront can render stores that haven't
 * been touched by the V3 customizer yet.
 *
 * The backend's `/storefront/theme/{store_id}` endpoint returns:
 *   {
 *     theme_id, bundle_url, css_url, customization,
 *     customization_v3: { schema_version: 3, templates, ... },
 *     ...
 *   }
 * — the V3 shape lives nested under `customization_v3`. Newer stores
 * have a populated `customization_v3` (V3 customizer or BYOT seed);
 * older stores have it empty and we fall back to `customization`
 * (legacy V1/V2 flat shape).
 */
export function resolveThemeSettings(raw: Record<string, any>): ThemeSettingsV3 {
  // Already V3
  if (raw?.schema_version === 3) {
    return raw as ThemeSettingsV3;
  }

  // Storefront `/storefront/theme/{id}` response shape — prefer the
  // nested V3 payload when present.
  if (raw?.customization_v3?.schema_version === 3) {
    return raw.customization_v3 as ThemeSettingsV3;
  }

  // Some callers pass `themeRaw.customization` (legacy flat) directly.
  if (raw?.customization && typeof raw.customization === "object" && !raw.schema_version) {
    raw = raw.customization;
  }

  // Normalize V1/V2
  const themeBlock = raw?.theme || {};
  const themeId = themeBlock.base_theme || "modern";

  const globalSettings: Record<string, any> = {};
  for (const key of ["primary_color", "secondary_color", "font_family", "logo_url"]) {
    if (themeBlock[key]) globalSettings[key] = themeBlock[key];
  }
  if (raw?.identity) globalSettings.identity = raw.identity;

  // Build home template
  const sections: Record<string, SectionInstance> = {};
  const order: string[] = [];

  if (raw?.hero) {
    sections["hero_1"] = {
      type: "hero",
      settings: {
        headline: raw.hero.headline || "",
        headline_ar: raw.hero.headline_ar || "",
        subtitle: raw.hero.subtitle || "",
        background_image: raw.hero.hero_image_url || "",
        cta_text: raw.hero.cta_text || "",
        cta_link: raw.hero.cta_link || "",
      },
    };
    order.push("hero_1");
  }

  if (raw?.products) {
    sections["featured_1"] = {
      type: "featured-products",
      settings: raw.products,
    };
    order.push("featured_1");
  }

  const templates: Record<string, PageTemplate> = {};
  if (Object.keys(sections).length > 0) {
    templates["home"] = { name: "Home", sections, order };
  }

  // Build section groups
  const sectionGroups: Record<string, SectionGroup> = {
    header: {
      name: "Header Group",
      sections: {
        header_1: { type: "header", settings: raw?.header || {} },
      },
      order: ["header_1"],
    },
    footer: {
      name: "Footer Group",
      sections: {
        footer_1: { type: "footer", settings: raw?.footer || {} },
      },
      order: ["footer_1"],
    },
  };

  // Handle external theme
  let externalTheme = null;
  if (raw?.external_theme?.bundle_url) {
    externalTheme = {
      bundle_url: raw.external_theme.bundle_url,
      css_url: raw.external_theme.css_url || null,
      mode: raw.external_theme.mode || "production",
    };
  }

  return {
    schema_version: 3,
    theme_id: themeId,
    global_settings: globalSettings,
    templates,
    section_groups: sectionGroups,
    external_theme: externalTheme,
  };
}
