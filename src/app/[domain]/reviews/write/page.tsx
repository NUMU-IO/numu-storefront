/**
 * /reviews/write?t=<token> — where a buyer rates what they bought, reached
 * from the Reviews app's WhatsApp button (`numueg.app/a/reviews/<sub>/<token>`).
 *
 * The token opens one delivered order of this store; NUMU-api decides what
 * the link may do (`GET …/apps/reviews/write`). The form is plain HTML that
 * works without script and posts to `/api/apps/reviews/write`; its script
 * only shrinks photos first. A store without the app goes to its home page.
 *
 * Standalone, like the unsubscribe page: the store's logo or name and its
 * brand tokens, no theme bundle.
 */

import type { CSSProperties } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { fetchStoreByDomain, fetchThemeSettings, internalFetch } from "@/lib/api-client";
import { brandFontHref, brandVarsToCss, resolveBrandTokens } from "@/lib/brand-tokens";
import { resolveThemeSettings } from "@/lib/resolve-theme";
import { isArabicLocale, NOINDEX_ROBOTS } from "@/lib/seo";
import { ReviewForm, type WriteInfo } from "./ReviewForm";

export const dynamic = "force-dynamic";

// A personal link: never indexed.
export const metadata: Metadata = { title: "Rate your order", robots: NOINDEX_ROBOTS };

const API_URL = process.env.NUMU_API_URL || "http://localhost:8021/api/v1";
const TOKEN = /^[A-Za-z0-9_-]{1,64}$/;

interface PageProps {
  params: Promise<{ domain: string }>;
  searchParams: Promise<{ t?: string; done?: string; error?: string }>;
}

export default async function WriteReviewPage({ params, searchParams }: PageProps) {
  const { domain } = await params;
  const { t: token = "", done, error } = await searchParams;
  const store = await fetchStoreByDomain(domain).catch(() => null);
  if (!store?.id) notFound();

  let info: WriteInfo | null = null;
  if (TOKEN.test(token)) {
    let res: Response | null = null;
    try {
      res = await internalFetch(
        `${API_URL}/storefront/store/${store.id}/apps/reviews/write?t=${token}`,
        { headers: { Accept: "application/json" }, cache: "no-store", signal: AbortSignal.timeout(5_000) },
      );
    } catch {
      res = null;
    }
    // The app is not installed (or was removed): the store's home page.
    if (res?.status === 404) redirect("/");
    if (res?.ok) info = await res.json();
  }

  const locale =
    (await headers()).get("x-numu-locale") ||
    (store as { default_language?: string }).default_language ||
    "ar";
  const ar = isArabicLocale(locale);
  const t = (en: string, arText: string) => (ar ? arText : en);

  const themeRaw = await fetchThemeSettings(store.id).catch(() => null);
  const brandGlobals = themeRaw
    ? (resolveThemeSettings(
        (themeRaw as { theme_settings?: unknown }).theme_settings || themeRaw || {},
      ).global_settings as Record<string, unknown> | undefined)
    : undefined;
  const brandVars = resolveBrandTokens(brandGlobals);
  const fontHref = brandFontHref(brandGlobals);

  const state = done ? "done" : (info?.state ?? "not_found");
  const message: Record<string, string> = {
    not_found: t("This link doesn't work.", "اللينك ده مش شغّال."),
    expired: t("This link has expired.", "اللينك ده خلص وقته."),
    done: t("Thank you! Your review helps other shoppers.", "شكراً! رأيك هيساعد ناس كتير تختار صح."),
  };

  return (
    <div
      lang={ar ? "ar" : "en"}
      dir={ar ? "rtl" : "ltr"}
      className="min-h-screen bg-[var(--ck-bg)] text-[var(--ck-fg)] [font-family:var(--ck-body-font)]"
      style={brandVars as CSSProperties}
    >
      {fontHref && <link rel="stylesheet" href={fontHref} />}
      <style dangerouslySetInnerHTML={{ __html: brandVarsToCss(brandVars) }} />
      <header className="border-b border-[var(--ck-border)] bg-[var(--ck-surface)]">
        <div className="mx-auto flex max-w-xl items-center px-4 py-4">
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
      <main className="mx-auto max-w-xl px-4 py-8">
        {state === "open" && info ? (
          <ReviewForm token={token} info={info} ar={ar} error={error} />
        ) : (
          <div className="space-y-4 rounded-[var(--ck-radius)] border border-[var(--ck-border)] bg-[var(--ck-surface)] p-6">
            <p className="text-base" role="status">
              {message[state] ?? message.not_found}
            </p>
            <a href="/" className="inline-block min-h-11 py-3 text-sm underline underline-offset-4">
              {t("Back to the store", "ارجع للمتجر")}
            </a>
          </div>
        )}
      </main>
    </div>
  );
}
