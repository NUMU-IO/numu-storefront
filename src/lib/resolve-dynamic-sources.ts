/**
 * Host-side dynamic-source resolution (the host→bundle seam).
 *
 * "Dynamic sources" let a merchant bind a section/block setting to a value
 * pulled from store data at render time. They're persisted as a reserved-key
 * object — `{ __numu_source: "store.name" }` — see the SDK's
 * `utils/dynamicSources.ts`, whose path semantics this mirrors.
 *
 * ── The bug this fixes ────────────────────────────────────────────────────
 * A bound setting reaches a theme bundle as that raw object. Themes that read
 * settings WITHOUT the SDK's `useResolvedSettings` (e.g. a header reading
 * `instance.settings.announcement_text` directly), OR that read nested BLOCK
 * settings raw (which `useResolvedSettings` never walked — it only resolves a
 * section's top-level keys), render the object as a React child. React throws
 * "Objects are not valid as a React child", the per-section ErrorBoundary
 * catches it, and the merchant sees "Section failed to render — header threw
 * an error." Because the object persists in the saved draft, it crashes in the
 * editor preview, on the live storefront, AND after switching to another theme
 * (the new theme's header/hero render the same persisted ref → "switching
 * doesn't work"), and an undo that doesn't drop the ref leaves it broken.
 *
 * ── The fix ───────────────────────────────────────────────────────────────
 * Resolve every dynamic-source ref in `themeSettings` HERE, before the
 * settings ever reach a bundle. The host always has the store (and the current
 * product/collection on those routes), so `store.*` always resolves and
 * `product.*`/`collection.*` resolve on their pages. This neutralises the
 * crash for EVERY theme at once with no bundle rebuild — a bundle never sees a
 * raw ref. Refs the host can't resolve for the current context (e.g.
 * `product.*` on the home page, where there is no product) are LEFT INTACT so
 * the bundle's own in-tree `useResolvedSettings` can still resolve them where
 * it has the context. That makes this strictly additive: it never regresses
 * the existing dynamic-source feature, it only closes the crash.
 *
 * Structural sharing: every helper returns the *same* object reference when
 * nothing changed, so a store with no bindings gets back the identical
 * `themeSettings` (memo stays cheap; the bundle's reference-equality
 * short-circuits don't see spurious updates).
 */
import type {
  ThemeSettingsV3,
  StoreData,
  Product,
  Collection,
} from "@/types";

export interface DynamicResolveContext {
  store?: Pick<StoreData, "name" | "description" | "logo_url"> | null;
  product?: Product | null;
  collection?: Collection | null;
}

interface DynamicSourceRef {
  __numu_source: string;
}

/** Loose instance shape — tolerant of array/record block containers and of
 *  recursive blocks (the backend's `BlockInstance` nests; the host's narrow
 *  type doesn't declare it, but runtime data can carry it). */
interface AnyInstance {
  type?: string;
  settings?: Record<string, unknown>;
  blocks?: Record<string, AnyInstance> | AnyInstance[];
  [k: string]: unknown;
}

type InstanceContainer = Record<string, AnyInstance> | AnyInstance[];

function isDynamicSource(value: unknown): value is DynamicSourceRef {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { __numu_source?: unknown }).__numu_source === "string"
  );
}

function snippet(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .trim()
    .slice(0, 200);
}

function resolveStoreField(
  s: NonNullable<DynamicResolveContext["store"]>,
  field: string,
): unknown {
  switch (field) {
    case "name":
      return s.name ?? "";
    case "description":
      return s.description ?? "";
    case "logo":
      return s.logo_url ?? null;
    default:
      return null;
  }
}

function resolveProductField(p: Product, field: string): unknown {
  switch (field) {
    case "title":
    case "name":
      return p.name;
    case "description":
      return p.description ?? "";
    case "description_snippet":
      return snippet(p.description ?? "");
    case "price":
      return p.price;
    case "sku":
      return p.variants?.[0]?.sku ?? null;
    case "image":
    case "first_image_url":
      return p.images?.[0]?.url ?? null;
    case "slug":
      return p.slug;
    default:
      return null;
  }
}

function resolveCollectionField(c: Collection, field: string): unknown {
  switch (field) {
    case "title":
    case "name":
      return c.name;
    case "description":
      return c.description ?? "";
    case "description_snippet":
      return snippet(c.description ?? "");
    case "image":
      return c.image_url ?? null;
    case "slug":
      return c.slug;
    case "product_count":
      return c.product_count ?? null;
    default:
      return null;
  }
}

/**
 * Resolve one ref against the current host context.
 *   - `handled: true`  → this render has the context; replace the ref with
 *     `value` (which may legitimately be null, e.g. a store with no logo).
 *   - `handled: false` → no context for this root here; LEAVE the ref so the
 *     bundle's in-tree resolver can handle it on the right route.
 */
function resolveRef(
  ref: DynamicSourceRef,
  ctx: DynamicResolveContext,
): { handled: boolean; value?: unknown } {
  const path = ref.__numu_source;
  const dot = path.indexOf(".");
  const root = dot === -1 ? path : path.slice(0, dot);
  const field = dot === -1 ? "" : path.slice(dot + 1);
  switch (root) {
    case "store":
      // The store is always in context at the host seam; resolve null-safe.
      return {
        handled: true,
        value: ctx.store ? resolveStoreField(ctx.store, field) : null,
      };
    case "product":
      if (!ctx.product) return { handled: false };
      return { handled: true, value: resolveProductField(ctx.product, field) };
    case "collection":
      if (!ctx.collection) return { handled: false };
      return {
        handled: true,
        value: resolveCollectionField(ctx.collection, field),
      };
    default:
      return { handled: false };
  }
}

function resolveSettings(
  settings: Record<string, unknown> | undefined,
  ctx: DynamicResolveContext,
): Record<string, unknown> | undefined {
  if (!settings || typeof settings !== "object") return settings;
  let out: Record<string, unknown> | null = null;
  for (const key of Object.keys(settings)) {
    const v = settings[key];
    if (!isDynamicSource(v)) continue;
    const r = resolveRef(v, ctx);
    if (!r.handled) continue; // leave the ref for the bundle's in-tree resolver
    if (!out) out = { ...settings };
    out[key] = r.value === undefined ? null : r.value;
  }
  return out ?? settings;
}

function resolveInstance(
  inst: AnyInstance,
  ctx: DynamicResolveContext,
): AnyInstance {
  if (!inst || typeof inst !== "object") return inst;
  const settings = resolveSettings(inst.settings, ctx);
  const blocks =
    inst.blocks !== undefined ? resolveContainer(inst.blocks, ctx) : inst.blocks;
  if (settings === inst.settings && blocks === inst.blocks) return inst;
  const next: AnyInstance = { ...inst };
  next.settings = settings;
  if (inst.blocks !== undefined) next.blocks = blocks;
  return next;
}

function resolveContainer(
  container: InstanceContainer | undefined,
  ctx: DynamicResolveContext,
): InstanceContainer | undefined {
  if (!container || typeof container !== "object") return container;
  if (Array.isArray(container)) {
    let out: AnyInstance[] | null = null;
    for (let i = 0; i < container.length; i++) {
      const r = resolveInstance(container[i], ctx);
      if (r !== container[i]) {
        if (!out) out = container.slice();
        out[i] = r;
      }
    }
    return out ?? container;
  }
  let out: Record<string, AnyInstance> | null = null;
  for (const id of Object.keys(container)) {
    const r = resolveInstance(container[id], ctx);
    if (r !== container[id]) {
      if (!out) out = { ...container };
      out[id] = r;
    }
  }
  return out ?? container;
}

/** Walk a `Record<groupId, { sections }>` map (templates OR section_groups),
 *  resolving each group's `sections` container. Generic over the precise host
 *  group type (PageTemplate / SectionGroup) so the return type round-trips
 *  exactly — no lossy casts at the call site. */
function resolveGroupMap<G extends { sections?: unknown }>(
  map: Record<string, G>,
  ctx: DynamicResolveContext,
): Record<string, G> {
  if (!map || typeof map !== "object") return map;
  let out: Record<string, G> | null = null;
  for (const key of Object.keys(map)) {
    const group = map[key];
    if (!group) continue;
    const sections = resolveContainer(
      group.sections as InstanceContainer | undefined,
      ctx,
    );
    if (sections !== group.sections) {
      if (!out) out = { ...map };
      out[key] = { ...group, sections } as G;
    }
  }
  return out ?? map;
}

/**
 * Resolve every dynamic-source ref in a V3 themeSettings tree (templates +
 * section_groups → section settings → recursive block settings) against the
 * host's current store/product/collection context. Returns the same object
 * when nothing changed.
 */
export function resolveThemeSettingsDynamicSources(
  themeSettings: ThemeSettingsV3,
  ctx: DynamicResolveContext,
): ThemeSettingsV3 {
  if (!themeSettings || typeof themeSettings !== "object") return themeSettings;
  const templates = resolveGroupMap(themeSettings.templates, ctx);
  const section_groups = resolveGroupMap(themeSettings.section_groups, ctx);
  if (
    templates === themeSettings.templates &&
    section_groups === themeSettings.section_groups
  ) {
    return themeSettings;
  }
  return { ...themeSettings, templates, section_groups };
}
