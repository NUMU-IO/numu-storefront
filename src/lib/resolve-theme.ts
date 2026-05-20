import type { ThemeSettingsV3, SectionGroup, SectionInstance, PageTemplate, ExternalThemeMetadata } from "@/types";

/**
 * Dual-Read normalization: converts V1/V2 legacy payloads to V3 in memory.
 * This ensures the Next.js storefront can render stores that haven't
 * been touched by the V3 customizer yet.
 *
 * The incoming `raw` can take three shapes:
 *   1. **Raw V3 settings** — the `ThemeSettingsV3` object directly
 *      (`{ schema_version: 3, templates, section_groups, ... }`).
 *      Used when the caller already extracted `theme_settings`.
 *
 *   2. **V3 endpoint envelope** — what `/storefront/theme/{id}` returns:
 *      `{ theme_id (UUID), theme_slug, theme_type, bundle_url, css_url,
 *         customization: { schema_version: 3, templates, ... } }`.
 *      The `customization` payload *is* the V3 settings, but BYOT bits
 *      and the slug-style theme id live at the envelope root, so we
 *      have to merge them onto the customization shape before downstream
 *      code (which only looks at `themeSettings.external_theme` +
 *      `themeSettings.theme_id`) can dispatch correctly. Without this,
 *      every BYOT store would mis-resolve to a built-in fallback.
 *
 *   3. **V1/V2 legacy customization** — the flat
 *      `{ theme, hero, products, header, footer, identity, external_theme }`
 *      shape the old customization endpoints used.
 */
export function resolveThemeSettings(raw: Record<string, any>): ThemeSettingsV3 {
  // V3 endpoint envelope
  if (raw?.customization?.schema_version === 3) {
    const customization = raw.customization as ThemeSettingsV3;
    // BYOT bits — prefer customization's `external_theme` (which the
    // V3 customizer populates with the richer metadata: settings_schema
    // + section_schemas), fall back to the envelope's flat bundle_url
    // / css_url when only a build artifact is recorded.
    const envelopeExternal: ExternalThemeMetadata | null =
      typeof raw.bundle_url === "string"
        ? {
            bundle_url: raw.bundle_url,
            css_url: (raw.css_url as string | null) ?? null,
            mode:
              raw.theme_type === "external" ? "production" : "development",
          }
        : null;
    return {
      ...customization,
      // Prefer the human-readable slug over the DB UUID — sections look
      // it up via isBuiltInTheme() and against bundle paths, both of
      // which work off slugs (`empire-v3`, `bazar`, …), not UUIDs.
      theme_id:
        (typeof raw.theme_slug === "string" && raw.theme_slug) ||
        customization.theme_id,
      external_theme: customization.external_theme ?? envelopeExternal,
    };
  }

  // Already V3 (raw IS the ThemeSettingsV3 shape directly)
  if (raw?.schema_version === 3) {
    return raw as ThemeSettingsV3;
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
