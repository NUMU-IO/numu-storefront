/**
 * Server-side resolution of a V3 theme's webfont stylesheets.
 *
 * ## The problem this solves
 *
 * A BYOT theme's fonts are picked in the theme editor (`global_settings
 * .heading_font` / `.body_font`) and turned into Google-Fonts stylesheet links
 * by the SDK's `resolveFontStack`, which runs **inside the bundle, in the
 * browser**. That put font discovery at the end of the longest critical chain
 * on the page:
 *
 *     document → /__numu-runtime/sdk.js → fonts.googleapis.com/css2 → *.woff2
 *
 * Measured on vionneeg.com's mobile Lighthouse run that chain was **4.729 s**.
 * The browser cannot begin any of it until the runtime has downloaded and
 * evaluated, even though the answer — which two families this store uses — is
 * sitting in the theme settings the server already fetched to render the page.
 *
 * Emitting the links from the server collapses the chain to
 * `document → css2 → woff2`, discovered during HTML parse, in parallel with
 * everything else.
 *
 * ## Why the hrefs are duplicated here rather than imported
 *
 * `@numueg/theme-sdk`'s entry point pulls in its React client components, which
 * a server component must not import. The map below is therefore a copy of the
 * SDK's `FONT_REGISTRY` hrefs (`src/utils/styleTokens.ts`).
 *
 * ⚠️ They must stay **byte-identical**. The SDK's `injectFontLink` skips
 * injecting a stylesheet when it finds `link[data-numu-font][href="…"]` with
 * that exact href — which is precisely how the server-emitted link stops the
 * bundle from adding a second copy of the same stylesheet a few seconds later.
 * Change a weight list on one side and the store silently downloads both.
 */

/** Font token → Google Fonts stylesheet URL. Mirrors the SDK's FONT_REGISTRY. */
const FONT_HREFS: Record<string, string> = {
  cormorant:
    "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;0,700;1,400&display=swap",
  "dm-sans":
    "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,700&display=swap",
  playfair:
    "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap",
  inter:
    "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
  poppins:
    "https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap",
  montserrat:
    "https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap",
  lora: "https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;0,600;1,400&display=swap",
  cairo:
    "https://fonts.googleapis.com/css2?family=Cairo:wght@400;500;600;700&display=swap",
  tajawal:
    "https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700&display=swap",
};

/**
 * Every webfont stylesheet a store's `global_settings` imply, de-duplicated and
 * in a stable order (so the emitted HTML doesn't churn between renders).
 *
 * Only values that are *known registry tokens* resolve. A theme is free to
 * store a raw CSS stack (`"Georgia, serif"`) in a font setting; that loads no
 * webfont, and the SDK treats it the same way.
 */
export function resolveThemeFontHrefs(
  globalSettings: Record<string, unknown> | null | undefined,
): string[] {
  if (!globalSettings || typeof globalSettings !== "object") return [];
  const out: string[] = [];
  for (const value of Object.values(globalSettings)) {
    if (typeof value !== "string") continue;
    const href = FONT_HREFS[value];
    if (href && !out.includes(href)) out.push(href);
  }
  return out;
}

/**
 * Flip the server-emitted `media="print"` stylesheets to `all` once they have
 * loaded — the standard non-blocking-CSS pattern.
 *
 * `media="print"` is what keeps these OFF the critical rendering path: the
 * browser fetches them at low priority and never blocks first paint on them.
 * Without the swap they would apply to print only and the storefront would
 * render in the fallback stack forever.
 *
 * The `l.sheet` check handles the race where the stylesheet finished before
 * this script ran (a warm cache), in which case no `load` event is coming.
 */
export const FONT_SWAP_SNIPPET =
  `(function(){function sweep(){` +
  `var l=document.querySelectorAll('link[data-numu-font][media="print"]');` +
  `for(var i=0;i<l.length;i++){(function(k){` +
  `var go=function(){k.media='all'};` +
  `if(k.sheet)go();else k.addEventListener('load',go,{once:true});` +
  // A blocked/failed stylesheet must not leave the page print-only forever.
  `k.addEventListener('error',go,{once:true});` +
  `})(l[i]);}}` +
  `sweep();` +
  // Run again once the document is parsed. React hoists <link> elements ABOVE
  // inline scripts in the streamed <head> regardless of JSX order — the same
  // trap RuntimeImportMap documents — so the links this sweeps *should* already
  // exist when it first runs. "Should" is not good enough here: if the order
  // ever flipped, the first sweep would find nothing and the storefront would
  // render print-only fonts forever. The second pass costs one querySelectorAll
  // and removes the whole failure mode. `go` is idempotent, so re-sweeping a
  // link that already flipped does nothing (it no longer matches the selector).
  `if(document.readyState==='loading')` +
  `document.addEventListener('DOMContentLoaded',sweep,{once:true});` +
  `})();`;
