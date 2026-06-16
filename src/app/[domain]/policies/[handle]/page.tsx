/**
 * /policies/[handle] — store legal policy pages.
 *
 * Resolves the four canonical Shopify-parity handles
 * (`privacy`, `refund`, `terms`, `shipping`) and a generic catch-all
 * for merchant-defined custom policies. Body comes from
 * `store.settings.policies?.[handle]` — a plain-text or merchant-
 * edited HTML field set in the hub. v1 ships the route + render so
 * footer "Privacy" / "Refund" / "Terms" links resolve; the hub editor
 * UI is a separate workstream.
 *
 * BYOT bundles get `page.type = "policy"` so themes can ship a
 * branded policy template. Built-in fallback renders a plain prose
 * page.
 */
import { notFound } from "next/navigation";
import {
  fetchStoreByDomain,
  fetchThemeSettings,
} from "@/lib/api-client";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { isBuiltInTheme } from "@/components/theme-engine/ThemeRegistry";
import ByotThemeBoundary from "@/components/theme-engine/ByotThemeBoundary";
import type { Metadata } from "next";

interface PageProps {
  params: Promise<{ domain: string; handle: string }>;
}

const POLICY_TITLES: Record<string, string> = {
  privacy: "Privacy Policy",
  refund: "Refund Policy",
  terms: "Terms of Service",
  shipping: "Shipping Policy",
};

function titleFor(handle: string): string {
  return (
    POLICY_TITLES[handle] ||
    handle
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

function readPolicy(store: any, handle: string): string | null {
  const policies = store?.settings?.policies;
  if (!policies || typeof policies !== "object") return null;
  const body = policies[handle];
  return typeof body === "string" && body.trim() ? body : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain, handle } = await params;
  try {
    const store = await fetchStoreByDomain(domain);
    return { title: `${titleFor(handle)} | ${store?.name || "Store"}` };
  } catch {
    return { title: titleFor(handle) };
  }
}

export default async function PolicyPage({ params }: PageProps) {
  const { domain, handle } = await params;

  // Reject obviously bogus handles early — only allow the canonical
  // four plus simple slugs (lowercase, dash-separated). Stops random
  // /policies/<garbage> URLs from feeding into the policy content
  // resolver and rendering an empty page.
  if (!/^[a-z][a-z0-9-]*$/.test(handle)) {
    notFound();
  }

  let store;
  try {
    store = await fetchStoreByDomain(domain);
  } catch {
    notFound();
  }

  const themeRaw = await fetchThemeSettings(store.id).catch(() => null);
  const themeSettings = resolveThemeSettings(themeRaw?.theme_settings || themeRaw || {});

  const title = titleFor(handle);
  const body = readPolicy(store, handle);

  const isByot =
    themeSettings.external_theme?.bundle_url &&
    !isBuiltInTheme(themeSettings.theme_id);

  // Built-in policy view — the ENG-2 no-blank backstop (and the built-in-theme
  // fallback): a theme that ships no `policy` template would otherwise render
  // an empty page when footer "Privacy/Refund/Terms" links resolve here.
  const builtInPolicy = (
    <main className="max-w-3xl mx-auto px-4 py-12">
      <h1 className="text-3xl font-bold mb-6">{title}</h1>
      {body ? (
        // Merchant-controlled content: rendered as plain text with
        // line breaks preserved. We avoid dangerouslySetInnerHTML in
        // the built-in fallback because we can't guarantee the hub
        // editor sanitizes — themes that want rich rendering will
        // pull `policy.body` and render through their own RichText
        // component (which the SDK ships sanitized).
        <div className="prose prose-gray max-w-none whitespace-pre-wrap text-gray-800">
          {body}
        </div>
      ) : (
        <p className="text-gray-600">
          This policy hasn't been published yet.
        </p>
      )}
    </main>
  );

  if (isByot) {
    return (
      <ByotThemeBoundary
        bundleUrl={themeSettings.external_theme!.bundle_url!}
        cssUrl={themeSettings.external_theme!.css_url}
        themeSettings={themeSettings}
        storeData={store}
        page={{
          type: "policy",
          title,
          handle,
          data: { policy: { handle, title, body } },
        }}
        routeFallback={builtInPolicy}
      />
    );
  }

  return builtInPolicy;
}
