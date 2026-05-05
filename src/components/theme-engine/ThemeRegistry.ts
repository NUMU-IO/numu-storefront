import type { SectionProps, BlockProps } from "@/types";
import { ComponentType } from "react";

type SectionComponent = ComponentType<SectionProps>;
type BlockComponent = ComponentType<BlockProps>;

// Dynamic-import factories. Each factory is invoked at most once per
// process: results are cached in `_resolvedSections` / `_resolvedBlocks`
// below to avoid re-running webpack/Turbopack module resolution on every
// section render.

const SECTION_MODULES: Record<
  string,
  Record<string, () => Promise<{ default: SectionComponent }>>
> = {
  bazar: {
    hero: () => import("@/themes/bazar/sections/Hero"),
    "featured-products": () => import("@/themes/bazar/sections/FeaturedProducts"),
    categories: () => import("@/themes/bazar/sections/Categories"),
    banner: () => import("@/themes/bazar/sections/Banner"),
    "rich-text": () => import("@/themes/bazar/sections/RichText"),
    "image-with-text": () => import("@/themes/bazar/sections/ImageWithText"),
    newsletter: () => import("@/themes/bazar/sections/Newsletter"),
    testimonials: () => import("@/themes/bazar/sections/Testimonials"),
    "product-grid": () => import("@/themes/bazar/sections/ProductGrid"),
    slideshow: () => import("@/themes/bazar/sections/Slideshow"),
    "video-section": () => import("@/themes/bazar/sections/VideoSection"),
    "collection-list": () => import("@/themes/bazar/sections/CollectionList"),
    "contact-form": () => import("@/themes/bazar/sections/ContactForm"),
    faq: () => import("@/themes/bazar/sections/FAQ"),
    "logo-list": () => import("@/themes/bazar/sections/LogoList"),
    "map-section": () => import("@/themes/bazar/sections/MapSection"),
    "multi-column": () => import("@/themes/bazar/sections/MultiColumn"),
  },
};

const SHARED_SECTIONS: Record<
  string,
  () => Promise<{ default: SectionComponent }>
> = {
  header: () => import("@/themes/shared/sections/Header"),
  footer: () => import("@/themes/shared/sections/Footer"),
  "announcement-bar": () => import("@/themes/shared/sections/AnnouncementBar"),
};

const BLOCK_MODULES: Record<
  string,
  Record<string, () => Promise<{ default: BlockComponent }>>
> = {
  bazar: {
    "product-card": () => import("@/themes/bazar/blocks/ProductCard"),
    "category-card": () => import("@/themes/bazar/blocks/CategoryCard"),
    "testimonial-card": () => import("@/themes/bazar/blocks/TestimonialCard"),
  },
};

const SHARED_BLOCKS: Record<
  string,
  () => Promise<{ default: BlockComponent }>
> = {
  heading: () => import("@/themes/shared/blocks/Heading"),
  paragraph: () => import("@/themes/shared/blocks/Paragraph"),
  button: () => import("@/themes/shared/blocks/Button"),
  image: () => import("@/themes/shared/blocks/Image"),
  divider: () => import("@/themes/shared/blocks/Divider"),
  spacer: () => import("@/themes/shared/blocks/Spacer"),
  "rich-text": () => import("@/themes/shared/blocks/RichText"),
  icon: () => import("@/themes/shared/blocks/Icon"),
};

// Per-process resolution cache. Maps `${themeId}:${type}` → resolved
// component. We store the in-flight Promise so concurrent renders don't
// double-load the same module.
const _resolvedSections = new Map<string, Promise<SectionComponent | null>>();
const _resolvedBlocks = new Map<string, Promise<BlockComponent | null>>();

export function resolveSection(
  themeId: string,
  sectionType: string,
): Promise<SectionComponent | null> {
  const key = `${themeId}:${sectionType}`;
  const cached = _resolvedSections.get(key);
  if (cached) return cached;

  const promise = (async () => {
    const themeModules = SECTION_MODULES[themeId];
    if (themeModules?.[sectionType]) {
      const mod = await themeModules[sectionType]();
      return mod.default;
    }
    if (SHARED_SECTIONS[sectionType]) {
      const mod = await SHARED_SECTIONS[sectionType]();
      return mod.default;
    }
    console.warn(`Section not found: ${sectionType} for theme ${themeId}`);
    return null;
  })();

  _resolvedSections.set(key, promise);
  return promise;
}

export function resolveBlock(
  themeId: string,
  blockType: string,
): Promise<BlockComponent | null> {
  // Skip @app/ blocks — handled by AppBlockLoader, not the static registry.
  if (blockType.startsWith("@app/")) return Promise.resolve(null);

  const key = `${themeId}:${blockType}`;
  const cached = _resolvedBlocks.get(key);
  if (cached) return cached;

  const promise = (async () => {
    const themeBlocks = BLOCK_MODULES[themeId];
    if (themeBlocks?.[blockType]) {
      const mod = await themeBlocks[blockType]();
      return mod.default;
    }
    if (SHARED_BLOCKS[blockType]) {
      const mod = await SHARED_BLOCKS[blockType]();
      return mod.default;
    }
    console.warn(`Block not found: ${blockType} for theme ${themeId}`);
    return null;
  })();

  _resolvedBlocks.set(key, promise);
  return promise;
}

export function isBuiltInTheme(themeId: string): boolean {
  return themeId in SECTION_MODULES;
}
