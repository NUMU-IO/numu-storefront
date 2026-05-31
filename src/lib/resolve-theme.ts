import type {
  ThemeSettingsV3,
  SectionGroup,
  SectionInstance,
  PageTemplate,
  ExternalThemeMetadata,
} from "@/types";

/**
 * Dual-Read normalization: converts V1/V2 legacy payloads to V3 in memory.
 * Also runs an engine-wide *sanitization* pass that strips templates and
 * groups of sections whose `type` isn't in the active theme's
 * `section_schemas`. Without that pass, a merchant switching from theme
 * A to theme B leaves the storefront rendering "Unknown section: hero"
 * placeholders for every section A had that B doesn't.
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
  const settings = normalizeRaw(raw);
  return sanitizeAgainstSchemas(settings);
}

// ── normalisation (V1 / V2 → V3) ──────────────────────────────────────────

function normalizeRaw(raw: Record<string, any>): ThemeSettingsV3 {
  // Already V3
  if (raw?.schema_version === 3) {
    return raw as ThemeSettingsV3;
  }

  // Storefront `/storefront/theme/{id}` response shape — prefer the
  // nested V3 payload when present.
  if (raw?.customization_v3?.schema_version === 3) {
    const v3 = raw.customization_v3 as ThemeSettingsV3;
    // The nested V3 customization doesn't carry external_theme metadata;
    // pull it from the outer envelope so sanitization has access to
    // section_schemas + presets.
    if (!v3.external_theme && raw?.external_theme?.bundle_url) {
      return {
        ...v3,
        external_theme: extractExternalTheme(raw.external_theme),
      };
    }
    return v3;
  }

  // Some callers pass `themeRaw.customization` (legacy flat) directly.
  if (
    raw?.customization &&
    typeof raw.customization === "object" &&
    !raw.schema_version
  ) {
    raw = raw.customization;
  }

  // Normalize V1/V2
  const themeBlock = raw?.theme || {};
  const themeId = themeBlock.base_theme || "modern";

  const globalSettings: Record<string, any> = {};
  for (const key of [
    "primary_color",
    "secondary_color",
    "font_family",
    "logo_url",
  ]) {
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

  const externalTheme = raw?.external_theme?.bundle_url
    ? extractExternalTheme(raw.external_theme)
    : null;

  return {
    schema_version: 3,
    theme_id: themeId,
    global_settings: globalSettings,
    templates,
    section_groups: sectionGroups,
    external_theme: externalTheme,
  };
}

function extractExternalTheme(raw: Record<string, any>): ExternalThemeMetadata {
  return {
    bundle_url: String(raw.bundle_url),
    css_url: raw.css_url ?? null,
    mode: raw.mode ?? "production",
    settings_schema: raw.settings_schema ?? null,
    section_schemas: raw.section_schemas ?? null,
    presets: raw.presets ?? null,
    theme_id: typeof raw.theme_id === "string" ? raw.theme_id : null,
  };
}

// ── sanitisation (drop unknown sections, fall back to presets) ────────────

/**
 * Strip sections whose `type` isn't in the active bundle's section
 * schemas. When a template ends up empty AND the bundle ships a preset
 * for that template, swap the preset in. Otherwise leave the template
 * empty so the bundle's own built-in preset (declared in its theme.json)
 * can take over via main.tsx's `BUILTIN_TEMPLATES[currentTemplate]`
 * fallback.
 *
 * No-op when `external_theme.section_schemas` is absent — that means we
 * don't know what the bundle supports and shouldn't strip anything.
 */
function sanitizeAgainstSchemas(settings: ThemeSettingsV3): ThemeSettingsV3 {
  const schemas = settings.external_theme?.section_schemas;
  if (!schemas || typeof schemas !== "object") return settings;

  // schemas is shaped as { sections: { [type]: SectionSchema }, blocks?: {...} }
  // — but some hosts pass it flatter as { [type]: schema }. Accept both.
  const sectionTypes = collectKnownTypes(schemas);
  if (sectionTypes.size === 0) return settings;

  const presetTemplates = collectPresetTemplates(
    settings.external_theme?.presets,
  );

  const cleanedTemplates: Record<string, PageTemplate> = {};
  for (const [key, template] of Object.entries(settings.templates ?? {})) {
    const cleaned = filterTemplate(template, sectionTypes);
    const hasSections =
      Object.keys(cleaned.sections ?? {}).length > 0 &&
      (cleaned.order ?? []).length > 0;
    if (hasSections) {
      cleanedTemplates[key] = cleaned;
    } else if (presetTemplates[key]) {
      cleanedTemplates[key] = presetTemplates[key];
    }
    // else: drop the template entirely; main.tsx falls back to BUILTIN
  }

  const cleanedGroups: Record<string, SectionGroup> = {};
  for (const [key, group] of Object.entries(settings.section_groups ?? {})) {
    cleanedGroups[key] = filterTemplate(group, sectionTypes);
  }

  return {
    ...settings,
    templates: cleanedTemplates,
    section_groups: cleanedGroups,
  };
}

function collectKnownTypes(schemas: Record<string, any>): Set<string> {
  const out = new Set<string>();
  const nested = schemas?.sections;
  if (nested && typeof nested === "object") {
    for (const key of Object.keys(nested)) out.add(key);
  } else {
    // Flat shape: keys are section types directly. Skip "blocks".
    for (const key of Object.keys(schemas)) {
      if (key !== "blocks") out.add(key);
    }
  }
  return out;
}

function collectPresetTemplates(
  presets: Record<string, any> | null | undefined,
): Record<string, PageTemplate> {
  if (!presets || typeof presets !== "object") return {};
  const raw = presets.templates;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, PageTemplate> = {};
  for (const [key, value] of Object.entries(
    raw as Record<string, unknown>,
  )) {
    const normalised = normalisePreset(value);
    if (normalised) out[key] = normalised;
  }
  return out;
}

/**
 * Theme.json presets are usually arrays of `{type, settings}` instances.
 * Convert to the V3 `{sections, order}` shape so the rest of the engine
 * doesn't have to special-case array vs map.
 */
function normalisePreset(value: unknown): PageTemplate | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const name = typeof v.name === "string" ? v.name : "Untitled";
  const rawSections = v.sections;

  if (Array.isArray(rawSections)) {
    const sections: Record<string, SectionInstance> = {};
    const order: string[] = [];
    rawSections.forEach((entry, idx) => {
      if (!entry || typeof entry !== "object") return;
      const inst = entry as Record<string, unknown>;
      const type = typeof inst.type === "string" ? inst.type : null;
      if (!type) return;
      const id = `${type}-${idx}`;
      sections[id] = {
        type,
        settings: (inst.settings as Record<string, unknown>) ?? {},
      };
      order.push(id);
    });
    return { name, sections, order };
  }

  if (rawSections && typeof rawSections === "object") {
    const order = Array.isArray(v.order)
      ? (v.order as unknown[]).filter((x): x is string => typeof x === "string")
      : Object.keys(rawSections as Record<string, unknown>);
    return {
      name,
      sections: rawSections as Record<string, SectionInstance>,
      order,
    };
  }

  return null;
}

interface MaybeOrdered {
  sections?: Record<string, SectionInstance>;
  order?: string[];
  name?: string;
}

function filterTemplate<T extends MaybeOrdered>(
  template: T,
  knownTypes: Set<string>,
): T {
  const inSections = template.sections ?? {};
  const inOrder = template.order ?? Object.keys(inSections);
  const outSections: Record<string, SectionInstance> = {};
  const outOrder: string[] = [];
  for (const id of inOrder) {
    const inst = inSections[id];
    if (!inst) continue;
    if (knownTypes.has(inst.type)) {
      outSections[id] = inst;
      outOrder.push(id);
    }
  }
  return { ...template, sections: outSections, order: outOrder };
}
