import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { fetchStoreByDomain } from "@/lib/api-client";
import { RuntimeImportMap } from "@/components/theme-engine/RuntimeImportMap";

export const metadata: Metadata = {
  title: "NUMU Store",
  description: "Powered by NUMU",
};

const RTL_LOCALES = new Set(["ar", "he", "fa", "ur"]);

/**
 * Resolve the active store's preferred language from the request URL.
 *
 * In production with subdomain routing the proxy.ts middleware
 * rewrites `<sub>.numueg.app/X` to `/<sub>/X`, and the path's first
 * segment is the store's subdomain. In dev with path-segment routing
 * the URL already has that shape. Either way we read the path from
 * the `x-numu-pathname` header that the proxy stamps (added below)
 * and look up the store.
 *
 * Failure modes are non-fatal: any error → English LTR. The render
 * still works; merchants just don't get the right `lang`/`dir`
 * attributes.
 */
async function resolveLocale(): Promise<{ lang: string; dir: "ltr" | "rtl" }> {
  try {
    const h = await headers();
    const path = h.get("x-numu-pathname") || h.get("x-invoke-path") || "";
    const seg = path.split("/").filter(Boolean)[0];
    const POST_DOMAIN = new Set([
      "collections",
      "products",
      "cart",
      "checkout",
      "account",
      "search",
      "pages",
      "blogs",
      "_next",
      "api",
    ]);
    if (!seg || POST_DOMAIN.has(seg)) {
      return { lang: "en", dir: "ltr" };
    }
    const store = await fetchStoreByDomain(seg).catch(() => null);
    const lang = (store?.default_language as string) || "en";
    return { lang, dir: RTL_LOCALES.has(lang) ? "rtl" : "ltr" };
  } catch {
    return { lang: "en", dir: "ltr" };
  }
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { lang, dir } = await resolveLocale();
  return (
    <html lang={lang} dir={dir}>
      <head>
        {/*
          BYOT runtime import map. Federated theme bundles import
          `react`, `react/jsx-runtime`, `react-dom/client`, and
          `@numu/theme-sdk` as bare specifiers. Without an import map
          parsed by the browser BEFORE the bundle's dynamic import runs,
          those imports throw "Failed to resolve module specifier".

          Must live in <head> so the HTML parser sees it before the
          ByotThemeBoundary effect (which fires after hydration but
          uses an import map that was committed at parse time, per
          spec). Self-contained themes (federate: false) ignore it.
        */}
        <RuntimeImportMap />
      </head>
      <body>{children}</body>
    </html>
  );
}
