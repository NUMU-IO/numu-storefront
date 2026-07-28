"use client";

import {
  Component,
  Fragment,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { loadExternalTheme, loadExternalCSS } from "@/lib/external-loader";
import StorefrontSkeleton from "@/components/theme-engine/StorefrontSkeleton";
import { useThemeDataOptional } from "@/components/layout/ThemeDataProvider";
import {
  resolveThemeSettingsDynamicSources,
  type DynamicResolveContext,
} from "@/lib/resolve-dynamic-sources";
import type {
  ThemeSettingsV3,
  StoreData,
  Product,
  Collection,
  PageContextData,
} from "@/types";

/** Marks host-injected fallback content so the emptiness probe skips it. */
const FALLBACK_MARKER = "data-numu-route-fallback";

interface ByotThemeBoundaryProps {
  bundleUrl: string;
  cssUrl?: string | null;
  /** Optional SHA-256 hex digest from `marketplace_theme_versions.checksum`.
   *  When supplied, the loader verifies the fetched bundle against it
   *  before evaluation. */
  bundleChecksum?: string | null;
  themeSettings: ThemeSettingsV3;
  storeData: StoreData;
  /** Tells the bundle which template to render. Omit for home. */
  page?: PageContextData;
  /**
   * Phase 3.6 — visitor-chosen locale (from `?locale=ar` querystring or
   * the `numu_locale` cookie, resolved by the storefront proxy and
   * forwarded via the `x-numu-locale` header). When omitted, the bundle's
   * NuMuProvider falls back to `store.default_language`.
   */
  locale?: string;
  fallback?: ReactNode;
  /**
   * ENG-2 — page-type "no-blank" backstop. A BYOT bundle that ships no
   * template for the current route renders an empty wrapper into the mount
   * container (its app returns a childless element) → the page is blank with
   * no error. When the host detects that empty render AND the route supplied
   * a `routeFallback`, it shows this instead so no route is ever blank.
   * Passed by the cart / content-page / 404 routes; omitted on home / product
   * / collection (which render on every theme). Distinct from `fallback`,
   * which is the load/render ERROR UI.
   */
  routeFallback?: ReactNode;
  /**
   * ADR-7 — server-rendered content layer. Semantic, crawler-facing HTML
   * (h1 / description / price / images / links) rendered by the HOST from data
   * the route already fetched. Unlike `routeFallback` (which appears only when
   * the theme ships no template) this is present in the INITIAL RESPONSE even
   * when the theme renders fine — that's the whole point: a crawler that runs
   * no JS, and a no-JS visitor, get real content instead of "Loading…".
   *
   * It is rendered as a SIBLING of the mount container and dropped the instant
   * React hydrates (see `hydrated` below).
   *
   * ⚠️ It used to be rendered as the container's initial *children*, on the
   * reasoning that host React would always remove them before the bundle's
   * `createRoot(el)` could clear them, so the two React trees never contended
   * for the same DOM. That invariant only held while the bundle download was
   * slow. On a **popstate/Back** navigation the theme module is already in the
   * module cache, so `await import()` settles in a microtask and
   * `createRoot(container).render()` empties the container BEFORE React flushes
   * the `setHydrated(true)` re-render. React then committed a deletion for a
   * node whose `parentNode` was already null:
   *
   *   NotFoundError: Failed to execute 'removeChild' on 'Node':
   *   The node to be removed is not a child of this node.
   *
   * thrown from `commitDeletionEffects`. Reproduced 7/7 on Back into any route
   * carrying this layer (`/`, `/search`, `/products/{handle}`) and 0/12 on hard
   * loads and forward navigations. Because the boundary caught it, the shopper
   * got the route fallback on `/search` and "Failed to load theme" on routes
   * with none.
   *
   * A sibling costs a brief layout shift when the theme takes over, and removes
   * the shared-ownership hazard entirely: no node host React manages is ever
   * inside the element the bundle owns. That trade is not close.
   */
  seoContent?: ReactNode;
  /**
   * Isolated theme SSR (opt-in, `NUMU_SSR_THEME=1`) — the theme's OWN markup,
   * rendered server-side in a sandboxed child process from the identical mount
   * ctx (`src/lib/ssr-theme.ts`). When present it is injected into the mount
   * container as raw HTML and the bundle ADOPTS it via `hydrateRoot`
   * (`ctx.hydrate`), so the visitor sees the real theme in the first paint —
   * no skeleton, no blank flash — instead of waiting for the bundle.
   *
   * Null on every path where SSR is off, the theme isn't server-capable, or
   * the render failed: the component then behaves exactly as before. It is
   * deliberately mutually exclusive with `seoContent` — the theme's own markup
   * is strictly better for a crawler than the platform's semantic baseline,
   * and rendering both would duplicate the page's content.
   */
  ssrHtml?: string | null;
}

// The two shapes a bundle's `mount` may return:
//
//   * Legacy: a plain cleanup function (`() => void`). Every prop change
//     forces an unmount/remount of the bundle's React subtree.
//   * Modern: an object `{ unmount, update? }`. When `update` is
//     present, prop-only changes (themeSettings / storeData / page)
//     are forwarded into the same React tree without re-running the
//     dynamic import. The customizer's "every keystroke updates the
//     preview" loop drops from ~80ms-per-edit (full reload) to ~5ms
//     (in-place re-render).
//
// `numu-theme init` scaffolds the modern shape; older themes still work.
type BundleHandle =
  | (() => void)
  | {
      // Modern contract (scaffolded by `numu-theme init`).
      unmount?: () => void;
      update?: (props: BundleMountProps) => void;
      // Legacy / SDK MountResult contract (bon-younes et al.): `cleanup`
      // instead of `unmount`, `applyDraft(themeSettings)` instead of
      // `update(props)`. The host accepts both so unmount + live-preview
      // edits work regardless of which contract a bundle shipped with.
      cleanup?: () => void;
      applyDraft?: (themeSettings: ThemeSettingsV3) => void;
    };

interface BundleMountProps {
  themeSettings: ThemeSettingsV3;
  storeData: StoreData;
  page?: PageContextData;
  /** Isolated SSR — tells the SDK the container already holds server-rendered
   *  markup for this exact ctx, so it adopts it via `hydrateRoot` instead of
   *  rendering from scratch. Ignored (plain mount) on an empty container, so
   *  a failed server render degrades silently. */
  hydrate?: boolean;
  /** Visitor's active locale (Phase 3.6). Bundles forward this into
   *  NuMuProvider as `initialLocale`. Older bundles that don't read it
   *  fall through to `store.default_language` as before. */
  locale?: string;
  /** AUTHORITATIVE marketplace-preview flag — true ONLY for the catalog
   *  "Try theme" preview, false for editor/installed/public (see computeDemo).
   *  Bundles read it as `ctx.demo`. */
  demo?: boolean;
  /** Phase 2.4 — store navigation menus keyed by handle, resolved
   *  server-side and forwarded so the bundle's NuMuProvider populates
   *  `useNavigation(handle)` without a client round-trip. */
  navigation?: Record<string, unknown[]>;
}

type BundleModule = {
  mount?: (el: HTMLElement, props: BundleMountProps) => BundleHandle;
  default?: unknown;
};

function callUnmount(handle: BundleHandle | null): void {
  if (!handle) return;
  if (typeof handle === "function") {
    handle();
    return;
  }
  // Modern bundles expose `unmount`; legacy/SDK MountResult exposes `cleanup`.
  if (typeof handle.unmount === "function") handle.unmount();
  else if (typeof handle.cleanup === "function") handle.cleanup();
}

/**
 * AUTHORITATIVE marketplace-preview signal, passed to every V3 bundle as
 * `ctx.demo`. The hub opens the catalog "Try theme" preview iframe at the
 * storefront with `?preview_theme_slug=<slug>` (proxy.ts forwards it as a
 * header AND, being an internal rewrite, keeps it in the client URL). The
 * editor preview (`?preview=true&editor=v3`), installed/activated stores, and
 * public SSR NEVER carry `preview_theme_slug` → demo=false.
 *
 * This replaces the bundle's own fragile empty-templates inference as the
 * demo trigger: a real installed store whose stored customization diverges
 * from the active bundle's schemas can have its `templates` emptied by the
 * storefront sanitiser, which would otherwise flip the bundle into demo mode
 * and render demo (coffee) imagery on a live merchant store. Keying demo on
 * the preview marker — never on store data — makes that impossible by design.
 * Bundles built with `typeof ctx.demo === "boolean" ? ctx.demo : …` honour
 * this; older bundles fall back to their own inference (harmless).
 */
function computeDemo(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(
      new URLSearchParams(window.location.search).get("preview_theme_slug"),
    );
  } catch {
    return false;
  }
}

function tryUpdate(
  handle: BundleHandle | null,
  props: BundleMountProps,
): boolean {
  if (!handle || typeof handle !== "object") return false;
  // Modern contract: update(props). Legacy/SDK MountResult: applyDraft(settings).
  if (typeof handle.update === "function") {
    handle.update(props);
    return true;
  }
  if (typeof handle.applyDraft === "function") {
    handle.applyDraft(props.themeSettings);
    return true;
  }
  return false;
}

// ── Bundle ErrorBoundary ────────────────────────────────────────────────────
//
// React's class ErrorBoundary is the only way to catch render-time errors
// from a child subtree. We use it at the host/bundle seam so:
//
//   1. A throw inside `mount()` during the synchronous initial render
//      (e.g. createRoot(el).render(<Theme/>) where <Theme> throws) is
//      caught by THIS boundary instead of crashing the host's React tree
//      (the iframe whitescreens with "Application error"). Without it,
//      one bad theme makes the entire storefront unrenderable.
//
//   2. The bundle's OWN React subtree is isolated by its own root
//      (createRoot owns its tree). Errors there generally don't reach
//      this boundary — they surface in the bundle's own error handlers.
//      This boundary catches the seam: anything host-React renders
//      around the bundle's container.
//
//   3. We post `numu:editor:bundle-error` to window.parent with the
//      error message so the V3 customizer can show "Theme threw an
//      error" inline next to the iframe instead of leaving merchants
//      staring at a frozen preview.
//
// We don't use `getDerivedStateFromError` to set fallback content here
// because the parent component already handles the visible fallback —
// we just need to swallow the error so the host doesn't propagate it.

interface BoundaryState {
  error: Error | null;
}

class ThemeRenderBoundary extends Component<
  {
    children: ReactNode;
    onError: (err: Error) => void;
    fallback: ReactNode;
    /**
     * Changes when the visitor moves to a different page. An error boundary has
     * no way to recover on its own, so without this a SINGLE throw was
     * permanent: the boundary kept rendering `fallback` for every subsequent
     * client-side navigation until a hard reload. One bad render on one route
     * therefore took out the theme for the rest of the session — which is how a
     * single `removeChild` race turned into "search is flat AND Back says
     * Failed to load theme". A route change is new work and deserves a fresh
     * attempt; if it throws again the boundary simply catches it again.
     */
    resetKey?: string;
  },
  BoundaryState
> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error) {
    // Notify the wrapper so it can postMessage to the editor and re-render
    // the visible fallback. Console-log too so dev tools shows the trace.
    console.error("[ByotThemeBoundary] bundle render threw:", error);
    this.props.onError(error);
  }

  render() {
    if (this.state.error) return this.props.fallback;
    return this.props.children;
  }
}

/**
 * Best-effort shopper-side telemetry: beacon a theme load/render failure to
 * /api/theme-error (logged server-side, shipped to CloudWatch). SSR-guarded
 * (navigator is client-only) and never throws — telemetry must not break the
 * page. Unlike the editor postMessage below, this fires on real top-level
 * shopper pages too, which is exactly where we're blind today.
 */
/**
 * Pull the theme slug and version out of a bundle URL.
 *
 * Published bundles live at `<cdn>/<slug>/<version>/theme.js`, e.g.
 * `https://cdn.numueg.app/vionne-v3/0.6.4/theme.js`, so the URL is the one
 * place both facts are always available at the moment a bundle fails — which
 * is precisely when the beacon fires. The resolved theme model does not carry
 * a version at all, which is why `theme_version` was empty on every row of
 * `theme_error_events`: the ingest supports the column, nothing ever populated
 * it, and a crash could not be attributed to a release.
 *
 * Returns nulls rather than throwing for a dev/local URL that doesn't match
 * the shape — telemetry must never be the thing that breaks.
 */
function themeIdentityFromBundleUrl(bundleUrl?: string | null): {
  slug: string | null;
  version: string | null;
} {
  if (!bundleUrl) return { slug: null, version: null };
  try {
    const segments = new URL(bundleUrl, "https://placeholder/").pathname
      .split("/")
      .filter(Boolean);
    // …/<slug>/<version>/theme.js — take the two segments before the filename.
    if (segments.length < 3) return { slug: null, version: null };
    const version = segments[segments.length - 2] ?? null;
    const slug = segments[segments.length - 3] ?? null;
    // Only accept a version-shaped segment; a local dev URL like
    // `:5173/theme.js` must not report "5173" as a release.
    return /^\d+\.\d+\.\d+/.test(version ?? "")
      ? { slug, version }
      : { slug: null, version: null };
  } catch {
    return { slug: null, version: null };
  }
}

function beaconThemeError(payload: {
  store?: string | null;
  bundleUrl?: string | null;
  message: string;
  stack?: string | null;
  themeSlug?: string | null;
  themeVersion?: string | null;
}): void {
  if (
    typeof navigator === "undefined" ||
    typeof navigator.sendBeacon !== "function"
  ) {
    return;
  }
  try {
    // Theme identity for the backend ingest. Prefer whatever the caller knew;
    // fall back to the bundle URL, which encodes both and is always present on
    // a bundle failure. Callers were passing `theme_id` (a UUID) as the slug,
    // so `theme_slug` held things like "583aecc8-4842-…" — unreadable in the
    // hub and useless for grouping crashes by theme.
    const fromUrl = themeIdentityFromBundleUrl(payload.bundleUrl);
    const body = JSON.stringify({
      store: payload.store ?? null,
      bundleUrl: payload.bundleUrl ?? null,
      message: payload.message,
      stack: payload.stack ?? null,
      themeSlug: payload.themeSlug ?? fromUrl.slug ?? null,
      themeVersion: payload.themeVersion ?? fromUrl.version ?? null,
      url: typeof window !== "undefined" ? window.location.href : null,
    });
    navigator.sendBeacon(
      "/api/theme-error",
      new Blob([body], { type: "application/json" }),
    );
  } catch {
    // sendBeacon can throw (e.g. payload too large / disabled) — ignore.
  }
}

function postBundleError(
  error: Error,
  ctx?: {
    store?: string | null;
    bundleUrl?: string | null;
    themeSlug?: string | null;
    themeVersion?: string | null;
  },
) {
  if (typeof window === "undefined") return;
  // Telemetry first — must run on real (top-level) shopper pages, not just
  // inside the editor iframe.
  beaconThemeError({
    store: ctx?.store ?? null,
    bundleUrl: ctx?.bundleUrl ?? null,
    message: error.message,
    stack: error.stack ?? null,
    themeSlug: ctx?.themeSlug ?? null,
    themeVersion: ctx?.themeVersion ?? null,
  });
  // Editor integration: only meaningful inside the customizer iframe.
  if (window.parent === window) return;
  try {
    window.parent.postMessage(
      {
        type: "numu:editor:bundle-error",
        payload: { message: error.message, stack: error.stack ?? null },
      },
      "*",
    );
  } catch {
    // Cross-origin postMessage with `*` should always succeed; if it
    // doesn't there's nothing useful to do.
  }
}

/**
 * The mount container when the theme was server-rendered.
 *
 * `memo` here is load-bearing, not an optimisation. React re-applies
 * `dangerouslySetInnerHTML` on the FIRST update after hydration even when the
 * `__html` string is byte-identical — measured: the server markup was hydrated
 * fine, then the very next render (a `setState` elsewhere in this component)
 * called `set innerHTML` with the same 39,745 characters, destroying all 11
 * server nodes and recreating them. The theme then mounted into a container
 * that had just been rebuilt, so `hydrate` was pointless and the whole subtree
 * was rendered twice.
 *
 * Memoising on a stable `html` string + a stable ref object means this element
 * never re-renders, so React never touches its children again and the theme's
 * `hydrateRoot` adopts the original DOM. Nothing here may depend on changing
 * state — that is the entire point.
 */
const SsrThemeContainer = memo(function SsrThemeContainer({
  html,
  containerRef,
}: {
  html: string;
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={containerRef}
      // The server markup belongs to the THEME's React root, not this one —
      // host React must not try to reconcile it.
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

export default function ByotThemeBoundary({
  bundleUrl,
  cssUrl,
  bundleChecksum,
  themeSettings,
  storeData,
  page,
  locale,
  fallback,
  routeFallback,
  seoContent,
  ssrHtml,
}: ByotThemeBoundaryProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<BundleHandle | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // Navigation identity. Both this wrapper's `error` and the class boundary's
  // caught error are sticky by nature, so a single failed render used to
  // persist for every later client-side navigation until a hard reload. A route
  // change is a fresh attempt.
  const pathname = usePathname();
  // With server-rendered theme markup already on screen there is nothing to
  // wait for — showing a skeleton over real content would be a regression.
  const hasSsrHtml = typeof ssrHtml === "string" && ssrHtml.length > 0;
  const [loading, setLoading] = useState(!hasSsrHtml);
  // ENG-2 — set once the grace window elapses if the mounted bundle rendered
  // no meaningful content into the container, so we can show `routeFallback`.
  const [bundleEmpty, setBundleEmpty] = useState(false);
  // ADR-7 — the server-rendered content layer is part of the SSR HTML and is
  // dropped as soon as JS runs. `false` on the server AND on the first client
  // render (so hydration matches the markup byte-for-byte), flipped in an
  // effect that runs long before the awaited dynamic import resolves — so the
  // container is already empty and host-React-clean when `mount()` is called.
  const [hydrated, setHydrated] = useState(false);
  const hasSeoContent = seoContent != null;
  useEffect(() => {
    // Only meaningful for the ADR-7 content layer. With server-rendered theme
    // markup there is no content layer on screen to drop, and skipping the
    // state change removes a render that would otherwise touch the container.
    if (hasSeoContent && !hasSsrHtml) setHydrated(true);
  }, [hasSeoContent]);
  // Phase 2.4 — store nav menus injected once by the layout. Stable per
  // session; read here (non-throwing) and forwarded into every mount ctx.
  // ENG-3 R1 — the layout also threads the resolved visitor locale here; fall
  // back to it when the page route didn't pass an explicit `locale` prop.
  const themeData = useThemeDataOptional();
  const navigation = themeData?.navigation;
  const effectiveLocale = locale ?? themeData?.locale;
  const hasRouteFallback = routeFallback != null;
  // The theme's <main>, when the bundle rendered chrome but no body for this
  // route. Non-null → portal the host's fallback in there so the shopper keeps
  // the store's header, navigation, cart and footer on the page.
  const [fallbackSlot, setFallbackSlot] = useState<HTMLElement | null>(null);

  // Dynamic-source resolution (host→bundle seam). Bind context from the store
  // (always present) plus the current product/collection the route supplied via
  // `page.data`. We resolve `themeSettings` HERE so a setting bound to a dynamic
  // source — `{ __numu_source: "store.name" }` — never reaches a theme bundle as
  // a raw object (which the bundle would render as a React child and crash:
  // "Section failed to render"). Memoized so a store with no bindings gets back
  // the identical object (no-op); see resolve-dynamic-sources.ts.
  const resolveCtx = useMemo<DynamicResolveContext>(
    () => ({
      store: storeData,
      product: (page?.data?.product as Product | undefined) ?? null,
      collection: (page?.data?.collection as Collection | undefined) ?? null,
    }),
    [storeData, page],
  );
  const resolvedThemeSettings = useMemo(
    () => resolveThemeSettingsDynamicSources(themeSettings, resolveCtx),
    [themeSettings, resolveCtx],
  );

  // ── Bundle lifecycle ──────────────────────────────────────────────────────
  //
  // Two effects, on purpose:
  //
  //   1. The MOUNT effect (deps: bundleUrl/cssUrl/bundleChecksum) owns
  //      the dynamic-import → mod.mount → cleanup cycle. It runs once
  //      per bundle URL, so changing settings doesn't re-fetch the JS.
  //
  //   2. The UPDATE effect (deps: themeSettings/storeData/page) calls
  //      `mod.update(props)` on the existing handle when the bundle
  //      supports it. For older bundles whose `mount` returned a plain
  //      cleanup function, we fall back to a remount by toggling the
  //      mount key — slow path, but only needed for legacy themes.
  //
  // This split is what lets the customizer keep the iframe up while
  // the merchant edits 100 settings in a row. Before this change every
  // keystroke triggered a full bundle re-import + unmount/remount of
  // the React subtree (~80ms each); now prop-only updates are ~5ms.

  useEffect(() => {
    let cancelled = false;
    // Clear any error from a previous route before re-attempting. Without this
    // the wrapper's `error` is as sticky as the class boundary's was, so one
    // failed mount kept "Failed to load theme" on screen for every subsequent
    // client-side navigation until a hard reload.
    setError(null);

    async function load() {
      try {
        if (cssUrl) loadExternalCSS(cssUrl);
        const mod = (await loadExternalTheme(bundleUrl, {
          expectedChecksum: bundleChecksum ?? null,
        })) as BundleModule;
        if (cancelled) return;
        const el = containerRef.current;
        if (!el) return;

        if (typeof mod.mount !== "function") {
          throw new Error(
            "Theme bundle does not export `mount(el, props)`. Older themes " +
              "rendered as a React component; that path is disabled until the " +
              "host ships an import map for shared React.",
          );
        }
        // Capture latest props at mount time. Subsequent updates are
        // delivered by the second effect; we don't read the closure-
        // captured values here because they'd be stale on the second
        // mount cycle if a settings change interleaves the import.
        handleRef.current = mod.mount(el, {
          themeSettings: resolvedThemeSettings,
          storeData,
          page,
          locale: effectiveLocale,
          demo: computeDemo(),
          navigation,
          // Isolated SSR: the container already holds this theme's markup for
          // this exact ctx, so the SDK adopts it with `hydrateRoot` instead of
          // re-rendering from scratch (no flash, no double paint). Guarded on
          // the container actually still having content — the SDK downgrades
          // to a plain client mount on an empty container anyway, but not
          // asking for hydration we can't honour keeps the intent honest.
          hydrate: hasSsrHtml && el.childNodes.length > 0,
        });
        // Don't tear the skeleton down the instant mount() returns:
        // createRoot().render() commits ASYNCHRONOUSLY (React 19), so the
        // container is still empty for a frame or two. Flipping `loading`
        // off here showed a blank body between the skeleton and the theme's
        // first paint — the "empty for a sec" flash reported on every nav.
        // Keep the skeleton up until the bundle actually paints content (or
        // a safety deadline) so the swap reads skeleton → theme, never
        // skeleton → blank → theme.
        {
          let revealed = false;
          const reveal = () => {
            if (revealed || cancelled) return;
            revealed = true;
            setLoading(false);
          };
          const hardDeadline = setTimeout(reveal, 1000);
          const tick = () => {
            if (revealed || cancelled) return;
            const node = containerRef.current;
            const painted =
              !!node &&
              ((node.textContent ?? "").trim().length > 0 ||
                node.querySelector(
                  "img, svg, picture, video, canvas, section, main, article, header, footer, h1, h2, p, button, a",
                ) != null);
            if (painted) {
              clearTimeout(hardDeadline);
              reveal();
            } else {
              requestAnimationFrame(tick);
            }
          };
          requestAnimationFrame(tick);
        }
      } catch (err) {
        if (cancelled) return;
        const e = err instanceof Error ? err : new Error(String(err));
        setError(e);
        setLoading(false);
        postBundleError(e, {
          store:
            storeData?.subdomain ?? storeData?.slug ?? storeData?.id ?? null,
          bundleUrl,
          // Deliberately NOT `theme_id`: that is a UUID and it is what used
          // to land in `theme_slug`. Leave it null and let beaconThemeError
          // derive the real slug + version from the bundle URL.
          themeSlug: null,
        });
      }
    }

    load();
    return () => {
      cancelled = true;
      const handle = handleRef.current;
      handleRef.current = null;
      if (handle) {
        try {
          callUnmount(handle);
        } catch (err) {
          // Defensive: a broken bundle's unmount can throw too.
          console.warn("[ByotThemeBoundary] unmount threw:", err);
        }
      }
    };
    // Mount is keyed on bundle identity AND the page identity (type+handle).
    // Setting tweaks still flow through the update effect (no remount), but a
    // SAME-ROUTE navigation (e.g. /products/A → /products/B, where Next keeps
    // this component mounted and only changes the param) must remount: the
    // SDK `applyDraft` update path carries themeSettings only, NOT `page`, so
    // without this the bundle's product/collection context (and its images)
    // would freeze on the first product until a full refresh. Cross-route navs
    // already remount via their own route segment, so this adds no extra cost
    // there — it only catches the same-route param switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundleUrl, cssUrl, bundleChecksum, page?.type, page?.handle]);

  // ── ENG-2: no-blank backstop ──────────────────────────────────────────────
  //
  // A BYOT bundle that ships no template for the current route renders an empty
  // wrapper into `containerRef` (its app returns a childless element), so the
  // page is blank with no console error. In preview mode the host can't tell
  // from `themeSettings.templates` (always {} for previews) whether the bundle
  // covers this route — the only reliable signal is observing that the bundle
  // produced no content. When it didn't AND the route supplied a
  // `routeFallback`, show that (a default cart / themed 404 / page body) so the
  // route is never blank.
  //
  // "Empty" is TEXT/descendant-based, NOT childElementCount: the bundle's empty
  // wrapper makes childElementCount === 1, so test for no rendered text AND no
  // media/interactive descendant. A real template (even "your cart is empty")
  // has substantial text and reads as non-empty immediately.
  useEffect(() => {
    if (loading || error || !hasRouteFallback) return;
    const el = containerRef.current;
    if (!el) return;

    // Look at the BODY, not the whole container. Themes render their chrome
    // (header/footer) for every route, including ones they ship no template
    // for — so measuring the container as a whole says "not empty" purely
    // because the header exists, and the route's real content never appears.
    // When the theme marks a <main>, that region alone decides.
    const bodyOf = (root: HTMLElement): HTMLElement =>
      (root.querySelector("main") as HTMLElement | null) ?? root;

    // Anything WE portalled in must not count as content, or the measurement
    // feeds on its own output: portal in → <main> is no longer empty → decide
    // the theme rendered after all → unmount the portal → <main> empty again →
    // portal in… The page visibly flickered on a ~2s cycle.
    const isHostInjected = (node: Node | null): boolean => {
      let e: Element | null =
        node instanceof Element ? node : (node?.parentElement ?? null);
      while (e) {
        if (e.hasAttribute?.(FALLBACK_MARKER)) return true;
        e = e.parentElement;
      }
      return false;
    };

    const hasContent = () => {
      const body = bodyOf(el);
      for (const node of Array.from(
        body.querySelectorAll(
          "img, svg, input, button, a, picture, video, iframe, canvas",
        ),
      )) {
        if (!isHostInjected(node)) return true;
      }
      const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      let text: Node | null;
      while ((text = walker.nextNode())) {
        if ((text.textContent ?? "").trim() && !isHostInjected(text)) return true;
      }
      return false;
    };

    let graceOver = false;
    // Before the grace ceiling: keep the fallback hidden (bundle may still be
    // committing). After: reflect the live DOM — show the fallback only while
    // the bundle is genuinely blank, and yield to it the instant real content
    // arrives (covers late <Suspense>/lazy section chunks without flicker).
    const sync = () => {
      const empty = graceOver && !hasContent();
      setBundleEmpty(empty);
      // A <main> means the theme gave us somewhere to put the body WITHOUT
      // throwing its chrome away. No <main> → legacy behaviour (hide the
      // container, render the fallback standalone).
      const main = el.querySelector("main") as HTMLElement | null;
      setFallbackSlot(empty ? main : null);
    };

    const obs = new MutationObserver(sync);
    obs.observe(el, { childList: true, subtree: true, characterData: true });

    // createRoot().render() commits asynchronously (React 19) and themes lazy-
    // load sections behind <Suspense>; wait before declaring the route blank.
    const deadline = setTimeout(() => {
      graceOver = true;
      sync();
    }, 1200);

    return () => {
      obs.disconnect();
      clearTimeout(deadline);
    };
    // Keyed on bundle identity + mount completion only — deliberately NOT on
    // themeSettings/page so editor live-edits don't re-trigger detection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundleUrl, cssUrl, bundleChecksum, loading, error, hasRouteFallback]);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    try {
      const ok = tryUpdate(handle, {
        themeSettings: resolvedThemeSettings,
        storeData,
        page,
        locale: effectiveLocale,
        demo: computeDemo(),
        navigation,
      });
      if (!ok) {
        // Legacy bundle (mount returned a cleanup function, no update
        // method). PreviewBridge already handles fine-grained settings
        // updates inside such bundles via postMessage, so missing
        // update() here just means the prop change won't be observed
        // out-of-band. Themes built with `numu-theme init` post-0.2.0
        // expose update() — log once so dev devs notice.
        console.debug(
          "[ByotThemeBoundary] bundle has no mod.update(); prop change " +
            "ignored (legacy mount contract). Update the theme scaffold.",
        );
      }
    } catch (err) {
      console.warn("[ByotThemeBoundary] update threw:", err);
    }
  }, [resolvedThemeSettings, storeData, page, effectiveLocale, navigation]);

  // Live-preview edits (editor only). The dashboard's LivePreview posts
  // `numu:theme:update` on every change; PreviewBridge re-dispatches it as a
  // `numu:theme-update` window event. The `themeSettings` PROP is server-
  // rendered and never changes on the client, so the update effect above
  // can't carry live edits — apply them straight to the bundle handle here via
  // update()/applyDraft(). Inert on the public storefront: nothing fires
  // `numu:theme-update` outside the editor iframe.
  useEffect(() => {
    // Editor iframe only — never wire this on the public storefront (a real
    // shopper's page is top-level). PreviewBridge (the sole emitter of
    // numu:theme-update) is already editor-gated; this is defense-in-depth so
    // the listener isn't even registered for shoppers.
    if (typeof window === "undefined" || window.parent === window) return;
    function onThemeUpdate(e: Event) {
      const next = (e as CustomEvent).detail as ThemeSettingsV3 | undefined;
      if (!next) return;
      try {
        // Resolve dynamic-source refs in the live draft too — the editor posts
        // the RAW draft (it keeps the `{ __numu_source }` ref so its inputs can
        // show "bound to store.name"); without this, binding a field would
        // crash the preview the instant the merchant picks a source.
        tryUpdate(handleRef.current, {
          themeSettings: resolveThemeSettingsDynamicSources(next, resolveCtx),
          storeData,
          page,
          locale: effectiveLocale,
          demo: computeDemo(),
          navigation,
        });
      } catch (err) {
        console.warn("[ByotThemeBoundary] live update threw:", err);
      }
    }
    window.addEventListener("numu:theme-update", onThemeUpdate as EventListener);
    return () =>
      window.removeEventListener(
        "numu:theme-update",
        onThemeUpdate as EventListener,
      );
  }, [storeData, page, effectiveLocale, navigation, resolveCtx]);

  // Load errors on routes that supplied a `routeFallback` (themed 404 /
  // default cart / page body) degrade to that fallback — a branded page
  // beats a raw "Failed to load theme" box. Routes without one keep the
  // diagnostic box (or an explicit `fallback` override).
  const fallbackUI =
    fallback ||
    routeFallback || (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2">
        <div className="text-red-500">Failed to load theme</div>
        {error && (
          <div className="text-xs text-gray-500 max-w-md text-center px-4">
            {error.message}
          </div>
        )}
      </div>
    );

  return (
    <ThemeRenderBoundary
      onError={(err) =>
        postBundleError(err, {
          store:
            storeData?.subdomain ?? storeData?.slug ?? storeData?.id ?? null,
          bundleUrl,
          // Deliberately NOT `theme_id`: that is a UUID and it is what used
          // to land in `theme_slug`. Leave it null and let beaconThemeError
          // derive the real slug + version from the bundle URL.
          themeSlug: null,
        })
      }
      fallback={fallbackUI}
      resetKey={pathname ?? undefined}
    >
      {/* The page is prerendered, but a BYOT theme paints only after its
          bundle downloads + mounts on the client. This loading branch is part
          of the SSR HTML (loading starts true), so a skeleton — not a blank
          frame — is what ships in the prerender and shows instantly, then the
          container below swaps in the real theme as soon as it mounts. Keeps
          the layout's shape (no CLS) and kills the empty flash on every page. */}
      {/* Explicit keys: these siblings appear/disappear as loading/error/
          bundleEmpty flip, and `routeFallback` is an element created by the
          calling PAGE — without keys React key-diffs the shifting list and
          warns ("child from RegisterPage" etc.) on every fallback route. */}
      {loading && !error && (
        <Fragment key="byot-skeleton">
          {/* ADR-7: with a content layer present, a no-JS visitor would
              otherwise have to scroll past a full-viewport shimmer that will
              never resolve (the bundle needs JS) before reaching the real
              content. `<noscript>` CSS hides the skeleton for exactly those
              visitors and is inert for everyone else — no JS involved either
              way. `dangerouslySetInnerHTML` is the documented way to put
              markup in a <noscript> without a hydration mismatch (browsers
              with scripting on parse noscript children as raw text). */}
          {hasSeoContent && (
            <noscript
              dangerouslySetInnerHTML={{
                __html:
                  "<style>[data-numu-theme-skeleton]{display:none!important}</style>",
              }}
            />
          )}
          <div data-numu-theme-skeleton="">
            <StorefrontSkeleton />
          </div>
        </Fragment>
      )}
      {error && <Fragment key="byot-error-fallback">{fallbackUI}</Fragment>}
      {/* ENG-2 — keep the bundle container mounted always; HIDE (not unmount)
          it when the bundle rendered blank so a late async render can still
          reconcile underneath the fallback without forcing a remount. */}
      {/* Two shapes of the same container, because React forbids children
          alongside dangerouslySetInnerHTML. */}
      {hasSsrHtml ? (
        /* Isolated SSR — the theme's own server-rendered markup, adopted by
           `hydrateRoot` when the bundle mounts. Rendered through a memoised
           child so no later state change in this component can make React
           re-apply the innerHTML and blow the server DOM away (see
           SsrThemeContainer). Deliberately carries no `bundleEmpty` styling:
           a server-rendered theme is by definition not empty, and making the
           element depend on changing state would defeat the memo. */
        <SsrThemeContainer
          key="byot-bundle-container"
          html={ssrHtml as string}
          containerRef={containerRef}
        />
      ) : (
        <>
          {/* ADR-7 content layer — crawler/no-JS baseline, dropped on hydration.
              A SIBLING of the mount container, never a child of it: the bundle
              calls `createRoot()` on that container and empties it, so anything
              host React owns in there is a node it may later try to delete
              after the bundle already removed it. See the `seoContent` prop
              doc for the NotFoundError that caused. */}
          {!hydrated && seoContent ? (
            <div key="byot-seo-content">{seoContent}</div>
          ) : null}
          <div
            key="byot-bundle-container"
            ref={containerRef}
            style={
              bundleEmpty && !fallbackSlot ? { display: "none" } : undefined
            }
          />
        </>
      )}
      {bundleEmpty && !error && !fallbackSlot && (
        <Fragment key="byot-route-fallback">{routeFallback}</Fragment>
      )}
      {bundleEmpty && !error && fallbackSlot
        ? createPortal(
            <div {...{ [FALLBACK_MARKER]: "" }}>{routeFallback}</div>,
            fallbackSlot,
          )
        : null}
    </ThemeRenderBoundary>
  );
}
