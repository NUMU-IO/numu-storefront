"use client";

/**
 * Meta Pixel bootstrap for the V3 storefront host.
 *
 * Mounted once in [domain]/layout.tsx (only when the store has at least one
 * enabled pixel — see resolveMetaPixelIds). It:
 *   1. Injects the Facebook Pixel base script + `fbq('init')` per pixel and
 *      fires the initial PageView. This is what sets the `_fbp` cookie that
 *      the /api/storefront/track proxy needs for CAPI match quality.
 *   2. Re-fires PageView on App-Router client navigations (the base snippet
 *      only fires once; SPA route changes don't reload the page).
 *   3. Bridges any theme/SDK-dispatched `numu:analytics:event` to the browser
 *      Pixel, reusing the SDK's event_id when present so Meta dedupes the
 *      browser event against the SDK's CAPI POST.
 *
 * The whole component is inert (returns the script + a noscript fallback);
 * the funnel events themselves are fired by <FunnelTracker> on the host's
 * product/search/checkout/thank-you routes.
 */

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  fbqTrack,
  FUNNEL_STEP_TO_META,
  EVENT_NAME_TO_FUNNEL_STEP,
} from "@/lib/meta-pixel";

interface AnalyticsEventDetail {
  event?: string;
  payload?: Record<string, unknown>;
  event_id?: string;
}

export function MetaPixel({ pixelIds }: { pixelIds: string[] }) {
  const pathname = usePathname();
  const firstRun = useRef(true);

  // PageView on client-side route changes. Skip the very first run — the base
  // snippet below already fired the initial PageView synchronously.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    fbqTrack("PageView", {});
  }, [pathname]);

  // Bridge theme/SDK events → browser Pixel. The SDK already POSTs the CAPI
  // side from useAnalytics().track(); we add the matching browser event so
  // themes that fire events get full Pixel coverage with no extra wiring.
  useEffect(() => {
    function onEvt(e: Event) {
      const d = (e as CustomEvent).detail as AnalyticsEventDetail | undefined;
      if (!d?.event) return;
      const step = EVENT_NAME_TO_FUNNEL_STEP[d.event];
      const metaEvent = step ? FUNNEL_STEP_TO_META[step] : undefined;
      if (!metaEvent) return;
      fbqTrack(metaEvent, d.payload || {}, d.event_id);
    }
    window.addEventListener("numu:analytics:event", onEvt as EventListener);
    return () =>
      window.removeEventListener(
        "numu:analytics:event",
        onEvt as EventListener,
      );
  }, []);

  if (!pixelIds.length) return null;

  const inits = pixelIds.map((id) => `fbq('init','${id}');`).join("");
  const snippet =
    `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?` +
    `n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;` +
    `n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;` +
    `t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}` +
    `(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');` +
    `${inits}fbq('track','PageView');` +
    `window.__numuPixelIds=${JSON.stringify(pixelIds)};`;

  return (
    <>
      <Script
        id="numu-meta-pixel"
        strategy="afterInteractive"
        dangerouslySetInnerHTML={{ __html: snippet }}
      />
      <noscript>
        {pixelIds.map((id) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={id}
            height={1}
            width={1}
            style={{ display: "none" }}
            alt=""
            src={`https://www.facebook.com/tr?id=${id}&ev=PageView&noscript=1`}
          />
        ))}
      </noscript>
    </>
  );
}
