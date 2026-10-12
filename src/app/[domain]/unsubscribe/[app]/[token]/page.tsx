/**
 * /unsubscribe/<app>/<token> — the shared page where a shopper stops an app's
 * messages. Back in Stock's WhatsApp "Stop alerts" button (through
 * `numueg.app/a/back-in-stock/<sub>/u/<token>`) and its email link land here.
 *
 * Reads the app's `unsubscribe/<token>` route through `relayPath`, so only an
 * app on the relay list and a well-formed token reach the API. One plain form
 * that works without script: it POSTs to this same URL, proxy.ts hands the
 * POST to the app relay, and the relay sends the browser back here with
 * `?done=1`. A mail client's one-click List-Unsubscribe POST takes the same
 * path and gets the API's answer.
 *
 * Standalone, like checkout: the store's logo or name and its brand tokens,
 * no theme bundle.
 */

import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { fetchStoreByDomain, fetchThemeSettings, internalServiceHeaders } from "@/lib/api-client";
import { relayPath } from "@/lib/app-relay";
import { brandFontHref, brandVarsToCss, resolveBrandTokens } from "@/lib/brand-tokens";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { isArabicLocale, NOINDEX_ROBOTS } from "@/lib/seo";

export const dynamic = "force-dynamic";

// A personal link: never indexed.
export const metadata: Metadata = { title: "Unsubscribe", robots: NOINDEX_ROBOTS };

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";

interface PageProps {
  params: Promise<{ domain: string; app: string; token: string }>;
  searchParams: Promise<{ done?: string }>;
}

export default async function UnsubscribePage({ params, searchParams }: PageProps) {
  const { domain, app, token } = await params;
  const { done } = await searchParams;
  const store = await fetchStoreByDomain(domain).catch(() => null);
  if (!store?.id) notFound();

  const locale =
    (await headers()).get("x-numu-locale") ||
    (store as { default_language?: string }).default_language ||
    "en";
  const t = (en: string, ar: string) => (isArabicLocale(locale) ? ar : en);

  let info: { store_name?: string; contact?: string | null } | null = null;
  const path = relayPath(store.id, app, ["unsubscribe", token]);
  if (path) {
    try {
      const res = await fetch(`${API_URL}${path}`, {
        headers: { Accept: "application/json", ...(await internalServiceHeaders()) },
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      if (res.ok) info = await res.json();
    } catch {
      info = null;
    }
  }

  const themeRaw = await fetchThemeSettings(store.id).catch(() => null);
  const brandGlobals = themeRaw
    ? (resolveThemeSettings(
        (themeRaw as { theme_settings?: unknown }).theme_settings || themeRaw || {},
      ).global_settings as Record<string, unknown> | undefined)
    : undefined;
  const brandVars = resolveBrandTokens(brandGlobals);
  const fontHref = brandFontHref(brandGlobals);
  const storeName = info?.store_name || store.name || "";

  return (
    <div
      className="min-h-screen bg-[var(--ck-bg)] text-[var(--ck-fg)] [font-family:var(--ck-body-font)]"
      style={brandVars as CSSProperties}
    >
      {fontHref && <link rel="stylesheet" href={fontHref} />}
      <style dangerouslySetInnerHTML={{ __html: brandVarsToCss(brandVars) }} />
      <header className="border-b border-[var(--ck-border)] bg-[var(--ck-surface)]">
        <div className="mx-auto flex max-w-md items-center px-4 py-4">
          <a href="/" className="inline-flex items-center">
            {store.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={store.logo_url} alt={store.name || ""} className="h-8 w-auto" />
            ) : (
              <span className="text-lg [font-family:var(--ck-heading-font)] [font-weight:var(--ck-heading-weight)]">
                {store.name}
              </span>
            )}
          </a>
        </div>
      </header>
      <main className="mx-auto max-w-md px-4 py-10">
        <div className="space-y-4 rounded-[var(--ck-radius)] border border-[var(--ck-border)] bg-[var(--ck-surface)] p-6">
          {!info ? (
            <p className="text-base">{t("This link doesn't work.", "اللينك ده مش شغّال.")}</p>
          ) : done ? (
            <p className="text-base" role="status">
              {t("Done — no more alerts.", "تمام، مش هنبعتلك تنبيهات تاني.")}
            </p>
          ) : (
            <>
              <h1 className="text-xl [font-family:var(--ck-heading-font)] [font-weight:var(--ck-heading-weight)]">
                {t("Stop these alerts?", "مش عايز تنبيهات تاني؟")}
              </h1>
              <p className="text-sm text-[var(--ck-muted)]">
                {t("We'll stop the product alerts from ", "هنوقف تنبيهات المنتجات اللي طلبتها من ")}
                <bdi>{storeName}</bdi>
                {t(" sent to ", " على ")}
                <bdi dir="ltr">{info.contact ?? ""}</bdi>.
              </p>
              <form method="post" action={`/unsubscribe/${app}/${token}`}>
                <button
                  type="submit"
                  className="min-h-11 w-full rounded-[var(--ck-radius)] bg-[var(--ck-button)] px-4 py-3 font-semibold text-[var(--ck-button-text)]"
                >
                  {t("Yes, stop them", "أيوه، وقّفها")}
                </button>
              </form>
            </>
          )}
          <a href="/" className="inline-block min-h-11 py-3 text-sm underline underline-offset-4">
            {t("Back to the store", "ارجع للمتجر")}
          </a>
        </div>
      </main>
    </div>
  );
}
