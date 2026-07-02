"use client";

/**
 * TikTok Pixel bootstrap for the V3 storefront host. Sibling of <MetaPixel>.
 *
 * Mounted once in [domain]/layout.tsx (only when the store has at least one
 * enabled TikTok pixel — see resolveTikTokPixelIds). It:
 *   1. Injects the TikTok Pixel base script + `ttq.load` per pixel and fires
 *      `ttq.page()`. This sets the `_ttp` cookie the /track proxy reads.
 *   2. Captures the `ttclid` URL param into a 30-day cookie on mount + every
 *      navigation (TikTok's SDK does NOT do this itself — unlike Meta's `_fbc`).
 *   3. Re-fires `ttq.page()` on App-Router client navigations.
 *   4. Bridges any theme/SDK-dispatched `numu:analytics:event` to the browser
 *      Pixel, reusing the SDK's event_id so TikTok dedupes the browser event
 *      against the SDK's Events API POST.
 *
 * The funnel events themselves are fired by the host's trackers via
 * `trackFunnel` (meta-pixel.ts), which now fires BOTH pixels with one event_id.
 */

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  ttqTrack,
  FUNNEL_STEP_TO_TIKTOK,
  ensureTtclidCaptured,
} from "@/lib/tiktok-pixel";
import { EVENT_NAME_TO_FUNNEL_STEP } from "@/lib/meta-pixel";

interface AnalyticsEventDetail {
  event?: string;
  payload?: Record<string, unknown>;
  event_id?: string;
}

interface TtqLike {
  page?: () => void;
}

export function TikTokPixel({ pixelIds }: { pixelIds: string[] }) {
  const pathname = usePathname();
  const firstRun = useRef(true);

  // Capture ttclid ASAP + re-check on navigation (the click id can arrive on
  // any deep-linked entry, not just the home page).
  useEffect(() => {
    ensureTtclidCaptured();
  }, [pathname]);

  // Pageview on client-side route changes. Skip the first run — the base
  // snippet already fired ttq.page() synchronously.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    const ttq = (window as unknown as { ttq?: TtqLike }).ttq;
    try {
      ttq?.page?.();
    } catch {
      /* never break navigation */
    }
  }, [pathname]);

  // Bridge theme/SDK events → browser Pixel. The SDK already POSTs the Events
  // API side from useAnalytics().track(); we add the matching browser event.
  useEffect(() => {
    function onEvt(e: Event) {
      const d = (e as CustomEvent).detail as AnalyticsEventDetail | undefined;
      if (!d?.event) return;
      const step = EVENT_NAME_TO_FUNNEL_STEP[d.event];
      const tiktokEvent = step ? FUNNEL_STEP_TO_TIKTOK[step] : undefined;
      if (!tiktokEvent) return;
      ttqTrack(tiktokEvent, d.payload || {}, d.event_id);
    }
    window.addEventListener("numu:analytics:event", onEvt as EventListener);
    return () =>
      window.removeEventListener(
        "numu:analytics:event",
        onEvt as EventListener,
      );
  }, []);

  if (!pixelIds.length) return null;

  const loads = pixelIds.map((id) => `ttq.load('${id}');`).join("");
  // Official TikTok Pixel base snippet (method-queue stub so ttq.track works
  // before the SDK finishes loading), followed by per-pixel load + page().
  const snippet =
    `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];` +
    `ttq.methods=["page","track","identify","instances","debug","on","off","once",` +
    `"ready","alias","group","enableCookie","disableCookie","holdConsent",` +
    `"revokeConsent","grantConsent"];ttq.setAndDefer=function(t,e){` +
    `t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};` +
    `for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);` +
    `ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)` +
    `ttq.setAndDefer(e,ttq.methods[n]);return e};` +
    `ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",` +
    `o=n&&n.partner;ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=r;ttq._t=ttq._t||{};` +
    `ttq._t[e]=+new Date;ttq._o=ttq._o||{};ttq._o[e]=n||{};n=d.createElement("script");` +
    `n.type="text/javascript";n.async=!0;n.src=r+"?sdkid="+e+"&lib="+t;` +
    `e=d.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};` +
    `${loads}ttq.page();` +
    `w.__numuTikTokPixelIds=${JSON.stringify(pixelIds)};` +
    `}(window,document,'ttq');`;

  return (
    <Script
      id="numu-tiktok-pixel"
      strategy="afterInteractive"
      dangerouslySetInnerHTML={{ __html: snippet }}
    />
  );
}
