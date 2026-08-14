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
  return sanitizeAgainstSchemas(normalizeThemeSettings(raw));
}

/**
 * Pre-sanitization normalized settings: the SAME V1/V2→V3 normalization that
 * `resolveThemeSettings` runs, but WITHOUT the schema-sanitization pass that
 * strips section types absent from the BYOT bundle's `section_schemas`.
 *
 * The host uses this to render a chrome-less BYOT store's configured global
 * `section_groups` (header/footer). Those groups carry `header`/`footer`
 * section types which a chrome-less bundle's `section_schemas` never declares,
 * so the normal (sanitized) `resolveThemeSettings` output strips them to empty
 * — leaving nothing to render. Header/footer resolve via the platform's SHARED
 * section components (theme-agnostic in `resolveSection`), so host-rendering
 * them is safe for any theme id.
 */
export function normalizeThemeSettings(raw: Record<string, any>): ThemeSettingsV3 {
  return normalizeRaw(raw);
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

    // The ACTIVE theme_version is authoritative for which bundle to load.
    // The outer envelope's bundle_url/css_url/settings_schema/section_schemas
    // come from that version (set by activate_theme), whereas the nested
    // customization_v3.external_theme is the merchant's captured customization
    // — which activate_theme PRESERVES verbatim on a same-theme update (the
    // theme-update channel), leaving its bundle_url pointing at the OLD
    // version. Since the storefront loads external_theme.bundle_url, an adopted
    // update would otherwise never reach the rendered store. Prefer the outer
    // envelope so the activated version always wins. (The synthesised preview
    // payload has no outer bundle_url and routes through the schema_version===3
    // branch above, so this never disturbs ?preview_theme_slug.)
    if (raw?.bundle_url) {
      const prev = v3.external_theme ?? null;
      const outerBundleUrl = String(raw.bundle_url);
      // Integrity digest for the ACTIVE version's bundle. The envelope's
      // `bundle_checksum` is authoritative (it describes the outer
      // bundle_url). The nested `prev.checksum` was captured at activation
      // for prev.bundle_url — inherit it ONLY when the URLs match, or a
      // theme update would pair the new bundle with the old digest and
      // fail closed under NEXT_PUBLIC_BYOT_CHECKSUM_ENFORCE.
      const checksum =
        (typeof raw.bundle_checksum === "string" && raw.bundle_checksum) ||
        (prev?.bundle_url === outerBundleUrl ? (prev?.checksum ?? null) : null);
      // Static error/loading templates.
      //
      // Themes declare these in theme.json (`error_template:
      // "templates/error.html"`) and the plugin copies the PATH into
      // manifest.json — but the theme-resolution endpoint does not surface the
      // field at all (verified: its payload has no `error_template` key), so
      // `external_theme.error_template_url` was never populated by anything
      // and `error.tsx` took its `if (!url) return;` path every single time.
      // Every V3 theme therefore promises a branded failure state and shows
      // the platform's generic one.
      //
      // Derived by CONVENTION rather than configuration: the deploy script
      // uploads `dist/` recursively, so `templates/*.html` always lands beside
      // `theme.js` under the same immutable version prefix. Resolving the
      // relative path against bundle_url is therefore correct whenever the
      // theme ships the file, and harmless when it does not — `error.tsx`
      // already falls back to platform chrome on a 404, and this fetch only
      // happens on a page that is already erroring.
      //
      // The durable fix is API-side: surface `error_template` /
      // `loading_template` on the resolution payload so the host can honour a
      // theme that names them something else.
      const templateUrl = (rel: string): string | null => {
        try {
          return new URL(rel, outerBundleUrl).toString();
        } catch {
          return null;
        }
      };

      return {
        ...v3,
        external_theme: {
          bundle_url: outerBundleUrl,
          css_url: raw.css_url ?? prev?.css_url ?? null,
          error_template_url:
            prev?.error_template_url ?? templateUrl("templates/error.html"),
          loading_template_url:
            prev?.loading_template_url ?? templateUrl("templates/loading.html"),
          mode: prev?.mode ?? "production",
          settings_schema: raw.settings_schema ?? prev?.settings_schema ?? null,
          section_schemas: raw.section_schemas ?? prev?.section_schemas ?? null,
          presets: prev?.presets ?? null,
          theme_id:
            (typeof raw.theme_id === "string" ? raw.theme_id : null) ??
            prev?.theme_id ??
            null,
          checksum: checksum || null,
        },
      };
    }

    // No outer bundle_url — lift external_theme off the envelope when the
    // nested block lacks it (preserves the prior fallback behaviour).
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
  const checksum = raw.checksum ?? raw.bundle_checksum ?? null;
  return {
    bundle_url: String(raw.bundle_url),
    css_url: raw.css_url ?? null,
    mode: raw.mode ?? "production",
    settings_schema: raw.settings_schema ?? null,
    section_schemas: raw.section_schemas ?? null,
    presets: raw.presets ?? null,
    theme_id: typeof raw.theme_id === "string" ? raw.theme_id : null,
    checksum: typeof checksum === "string" && checksum ? checksum : null,
  };
}

/**
 * Does this BYOT theme render its OWN header/footer chrome?
 *
 * BYOT bundles are expected to render their own navigation; the host
 * suppresses its platform chrome for them (see `layout.tsx`). But 10 of the
 * 16 V3 themes ship NO header/footer/cart sections at all, so those stores
 * render with no navigation and no way to reach the cart. This detector lets
 * the host render a neutral fallback nav ONLY for those themes.
 *
 * Signal: the bundle's `section_schemas` declares a header- or footer-type
 * section. Every chrome-carrying theme in the fleet registers a
 * `*-header` / `*-footer` (or bare `header` / `footer`) section type; the
 * chrome-less themes register only content sections (plus, in a few cases, a
 * `*-announcement-bar`, which is deliberately NOT treated as chrome).
 *
 * Fail-safe: when `section_schemas` is absent/empty we can't classify the
 * theme, so we return `true` ("has chrome") — the host then does NOT inject a
 * fallback, which can never regress the live chrome-carrying themes. The
 * fallback appears only when we positively see a populated schema with no
 * header/footer section.
 */
const CHROME_TYPE_RE = /(?:^|[-_])(?:header|footer|navbar|topbar)(?:$|[-_])|header$|footer$/i;

export function byotProvidesOwnChrome(settings: ThemeSettingsV3): boolean {
  const schemas = settings.external_theme?.section_schemas;
  if (!schemas || typeof schemas !== "object") return true; // unknown → assume chrome
  const types = collectKnownTypes(schemas as Record<string, any>);
  if (types.size === 0) return true; // unknown → assume chrome
  for (const type of types) {
    if (CHROME_TYPE_RE.test(type)) return true;
  }
  return false; // populated schema, no header/footer section → no own chrome
}

// ── template overrides (per-resource template variants) ───────────────────

/**
 * Resolve the template key for a route given a resource's `template_suffix`.
 *
 * Shopify OS 2.0-style: a product/collection/page can opt into an alternate
 * template variant keyed `"<baseType>.<suffix>"` (e.g. `product.wholesale`).
 * Falls back to the base type when there is no suffix or no matching variant —
 * a missing variant must never 404.
 */
export function resolveTemplateKey(
  baseType: string,
  suffix: string | null | undefined,
  templates: Record<string, PageTemplate> | undefined,
): string {
  if (suffix && templates) {
    const variantKey = `${baseType}.${suffix}`;
    if (templates[variantKey]) return variantKey;
  }
  return baseType;
}

/**
 * Return themeSettings with the base template for `baseType` swapped to the
 * resolved variant, so BOTH render paths honour the override with no SDK
 * change: the BYOT bundle (which looks up `templates[page.type]`) and the host
 * `PageTemplateRenderer` (which reads `templates[baseType]`) both pick up the
 * variant's sections. Returns the SAME object when no variant applies, so
 * callers can pass the result unconditionally.
 */
export function applyTemplateOverride(
  settings: ThemeSettingsV3,
  baseType: string,
  suffix: string | null | undefined,
): ThemeSettingsV3 {
  const templates = settings.templates;
  if (!suffix || !templates) return settings;
  const key = resolveTemplateKey(baseType, suffix, templates);
  if (key === baseType) return settings;
  return { ...settings, templates: { ...templates, [baseType]: templates[key] } };
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
