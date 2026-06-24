/**
 * /[domain]/product/[slug] — SINGULAR alias of the plural PDP route.
 *
 * Root-cause fix for the cross-theme "/product/<slug> → 404". Most V3 themes
 * (14 of 15) link products as `/product/<slug>` (singular), but the only
 * dedicated PDP route is `/products/[slug]` (plural). Without this alias the
 * singular links fall through to the `[...slug]` catch-all, whose
 * KNOWN_PAGE_HANDLES set has no `"product"` entry → notFound() → themed 404.
 *
 * IMPLEMENTATION — import + local re-export, NOT `export { default } from "…"`:
 *   A bare `export … from` re-export of another route's page can't be
 *   statically resolved by Next/Turbopack as THIS route's default + segment
 *   config; it compiled server-side (200) but threw a client-side hydration
 *   error, which — because BYOT themes mount client-side — blanked the theme
 *   chrome (the "nav bar disappeared" on product pages). Importing the page
 *   and re-exporting it as a local binding gives Next a real default export to
 *   analyze, so the page hydrates and the theme mounts normally.
 *
 * Renders the IDENTICAL PDP at the singular URL (no redirect — the address bar
 * stays `/product/<slug>`). Additive: a new route segment can only ever CATCH
 * `/product/<slug>` (previously a 404), so it has zero effect on any existing
 * route. The dynamic segment is `[slug]` (same name as the plural route), so
 * the imported page's `params: { domain, slug }` shape matches unchanged.
 */
import ProductPage, {
  generateMetadata as productMetadata,
} from "../../products/[slug]/page";

export const generateMetadata = productMetadata;

// Route-segment config must be statically declared per route. Mirror the
// plural PDP's 5-minute ISR.
export const revalidate = 300;

export default ProductPage;
