import { fetchStoreByDomain, fetchThemeSettings } from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { SectionGroupRenderer } from "@/components/theme-engine/SectionGroupRenderer";
import { ThemeDataProvider } from "@/components/layout/ThemeDataProvider";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import { PreviewBridge } from "@/components/theme-engine/PreviewBridge";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  UNLOCK_COOKIE,
  isUnlocked,
  readPasswordProtection,
} from "@/lib/store-lock";
import type { Metadata } from "next";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ domain: string }>;
}

export async function generateMetadata({ params }: { params: Promise<{ domain: string }> }): Promise<Metadata> {
  const { domain } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    return {
      title: store?.name || "NUMU Store",
      description: store?.description || "Powered by NUMU",
    };
  } catch {
    return { title: "NUMU Store" };
  }
}

export default async function StoreLayout({ children, params }: LayoutProps) {
  const { domain } = await params;

  let store;
  try {
    store = await fetchStoreByDomain(domain);
  } catch {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Store not found
      </div>
    );
  }

  // Pre-launch password gate. The merchant flips
  // `store.settings.password_protected.enabled` from the hub. Until
  // the visitor proves the password (cookie hash matches the stored
  // hash), every route renders the unlock form.
  //
  // Exemptions:
  //   - The /password route itself (otherwise infinite redirect).
  //   - The /api/* routes are served at the app root by Next, so they
  //     never go through this layout — the API proxies remain reachable
  //     for the unlock POST and any backend-only checks.
  const protection = readPasswordProtection(store);
  if (protection?.enabled) {
    const cookieStore = await cookies();
    const headerList = await headers();
    const path = headerList.get("x-numu-pathname") || "";
    // x-numu-pathname is the rewritten path: `/<domain>/<rest>`. Strip
    // the leading domain so we can check just the visitor-facing route.
    const visitorPath = path.startsWith(`/${domain}`)
      ? path.slice(`/${domain}`.length) || "/"
      : path || "/";
    const onPasswordRoute =
      visitorPath === "/password" || visitorPath.startsWith("/password/");
    if (!onPasswordRoute) {
      const unlockCookie = cookieStore.get(UNLOCK_COOKIE)?.value;
      if (!isUnlocked(unlockCookie, protection.password_hash)) {
        const next = encodeURIComponent(visitorPath || "/");
        redirect(`/password?next=${next}`);
      }
    }
  }

  // Stamp `numu_active_store` so the proxy.ts middleware can rebase
  // apex paths under `<domain>/...` even when Referer is missing
  // (deep-link landings, cross-origin Referers, privacy browsers).
  // Server-side cookie set is best-effort: throws when the response is
  // already streamed (Edge runtime restriction). Failure is non-fatal —
  // the next page load will set it.
  try {
    const cookieStore = await cookies();
    if (cookieStore.get("numu_active_store")?.value !== domain) {
      cookieStore.set("numu_active_store", domain, {
        path: "/",
        maxAge: 60 * 60 * 24 * 30, // 30d — refreshes on every visit anyway
        sameSite: "lax",
      });
    }
  } catch {
    /* ignore — cookies are advisory routing hints, not auth */
  }

  let themeRaw;
  try {
    themeRaw = await fetchThemeSettings(store.id);
  } catch {
    // Store exists but no active theme installation. Distinct from
    // "store not found" — the merchant has a store, they just haven't
    // picked a theme yet (or ran into the V3 install gap).
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2 text-center px-6">
        <h1 className="text-xl font-semibold">{store.name || "Store"}</h1>
        <p className="text-gray-500">
          No theme is installed on this store yet. Open the merchant hub →
          Online Store → Themes to install one.
        </p>
      </div>
    );
  }

  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});
  const isByot = !!themeSettings.external_theme?.bundle_url && !isBuiltInTheme(themeSettings.theme_id);

  return (
    <ThemeDataProvider themeSettings={themeSettings} storeData={store}>
      {/* Path-segment routing in dev: when the storefront is reached at
          `/<subdomain>/...` (rather than `<subdomain>.numueg.app`),
          relative anchors like `/collections/all` would otherwise hit
          the apex 404. `<base>` rebases all relative links against the
          subdomain prefix. Hoisted into <head> by Next.js automatically.
          Production (subdomain hosting) doesn't need this. */}
      <base href={`/${domain}/`} />
      {/* Phase 5.7 WCAG-AA — skip-to-content link.
          Keyboard users tab through the header before reaching the
          page body; a skip link lets them jump straight to main
          content. Hidden by default; reveals on focus. The href
          targets `#main` — every page wraps its primary content in
          <main id="main"> via the BYOT contract or via the built-in
          PageTemplateRenderer (also in this PR). */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-black focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
      >
        Skip to content
      </a>
      {/* Preview bridge — only active when ?preview=true&editor=v3.
          Listens for postMessage updates from the dashboard editor. */}
      <PreviewBridge />
      {!isByot && themeSettings.section_groups?.header && (
        <SectionGroupRenderer
          group={themeSettings.section_groups.header}
          themeId={themeSettings.theme_id}
          storeData={store}
        />
      )}
      {/* Skip-link target. BYOT bundles that render their own <main>
          win over this wrapper because the link's `#main` selector
          finds the FIRST element with that id; bundles render after
          this point, but a bundle without an id="main" falls back to
          this anchor. */}
      <div id="main">{children}</div>
      {!isByot && themeSettings.section_groups?.footer && (
        <SectionGroupRenderer
          group={themeSettings.section_groups.footer}
          themeId={themeSettings.theme_id}
          storeData={store}
        />
      )}
    </ThemeDataProvider>
  );
}
