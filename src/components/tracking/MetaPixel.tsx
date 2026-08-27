"use client";

/**
 * Meta Pixel bootstrap for the V3 storefront host.
 *
 * Mounted once in [domain]/layout.tsx (only when the store has at least one
 * enabled pixel — see resolveMetaPixelIds). It:
 *   1. Installs the Facebook Pixel stub, mints the first-party `_fbp`/`_fbc`
 *      cookies the /api/storefront/track proxy needs for CAPI match quality,
 *      and calls `fbq('init')` per pixel plus the initial PageView. Those calls
 *      QUEUE on the stub; `fbevents.js` itself is fetched on the shopper's
 *      first interaction and replays them (see lib/third-party-load.ts, and
 *      pass loadStrategy="immediate" to go back to eager loading).
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
  getEventId,
  pageViewEventId,
  getSessionFingerprint,
  FUNNEL_STEP_TO_META,
  EVENT_NAME_TO_FUNNEL_STEP,
} from "@/lib/meta-pixel";
import { applyAdvancedMatching } from "@/lib/meta-identity";
import {
  TP_GATE_SNIPPET,
  type PixelLoadStrategy,
} from "@/lib/third-party-load";

interface AnalyticsEventDetail {
  event?: string;
  payload?: Record<string, unknown>;
  event_id?: string;
}

export function MetaPixel({
  pixelIds,
  loadStrategy = "interaction",
}: {
  pixelIds: string[];
  /** See lib/third-party-load.ts. `"immediate"` restores eager SDK loading. */
  loadStrategy?: PixelLoadStrategy;
}) {
  const pathname = usePathname();
  const firstRun = useRef(true);

  // PageView on client-side route changes. Skip the very first run — the base
  // snippet below already fired the initial PageView synchronously. The shared
  // per-navigation event_id lets the backend's CAPI PageView (enqueued by
  // <PageViewTracker>'s /track POST) dedupe against this browser fire.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    fbqTrack("PageView", {}, pageViewEventId(pathname));
  }, [pathname]);

  // Attach `external_id` (and any identity already learned this page-load) to
  // the pixels once `getSessionFingerprint()` has resolved. The inline
  // bootstrap can only read a `numu_sid` cookie that already exists; on a
  // visitor's very first page it does not, and this covers that case. Runs
  // after the initial PageView by design — re-initialising is how Meta
  // attaches Advanced Matching to *subsequent* events, and the earlier event
  // is upgraded server-side by the identity-enrichment resend instead.
  useEffect(() => {
    try {
      applyAdvancedMatching(getSessionFingerprint());
    } catch {
      /* tracking must never break the page */
    }
  }, []);

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
      // Default the id rather than omitting it. `fbqTrack` passes
      // `eventID` only when truthy, so a theme dispatching an event without
      // one produced an fbq fire with NO eventID — inherently undedupable
      // against its CAPI twin, which Meta then counts twice.
      fbqTrack(metaEvent, d.payload || {}, d.event_id || getEventId());
    }
    window.addEventListener("numu:analytics:event", onEvt as EventListener);
    return () =>
      window.removeEventListener(
        "numu:analytics:event",
        onEvt as EventListener,
      );
  }, []);

  if (!pixelIds.length) return null;

  // First-party `_fbc` / `_fbp`, minted BEFORE fbevents.js loads.
  //
  // The pixel is client-only (`afterInteractive`), so `_fbp` did not exist
  // until the script had downloaded and run — while the first /track POST
  // fired in the same commit. Measured on the live dataset, that produced a
  // perfect coverage gradient: PageView 63.6% → ViewContent 95% → AddToCart
  // 100%, i.e. only the landing event was missing the cookie. Meta's own
  // guidance is to set these server/first-party with a 90-day expiry, and
  // `fbevents.js` ADOPTS an existing value rather than overwriting it, so
  // seeding them here is safe and closes the gap at the root.
  //
  // `fb.1.` matches what `_synthesize_fbc` sends from the API for a
  // `*.numueg.app` host, so both legs agree. `fbclid` is used verbatim —
  // Meta's spec says the click id is case sensitive and must not be modified.
  const bootstrap =
    `try{var _d=document,_l=location;` +
    `var _ck=function(n){var m=_d.cookie.match(new RegExp('(?:^|; )'+n+'=([^;]*)'));return m?m[1]:null};` +
    `var _sc=function(n,v){_d.cookie=n+'='+v+'; Path=/; Max-Age=7776000; SameSite=Lax'+(_l.protocol==='https:'?'; Secure':'')};` +
    // Meta's subdomainIndex = number of labels in the public suffix
    // (`app` → 1, `com.eg` → 2). The regex matches the generic two-label
    // pattern (`com.eg`, `co.uk`, `com.sa`, `net.au`, …) rather than an
    // enumerated list, so it cannot drift out of sync the way a hardcoded
    // table would. Must agree with `subdomain_index_for_host` in the API's
    // `meta/click_id.py` — the browser cookie WINS over server synthesis
    // (the proxy fills `body.fbc` from it), so a mismatch here silently
    // overrides the server's correct value on a custom domain.
    `var _sfx=_l.hostname.split('.').slice(-2).join('.');` +
    `var _si=/^(com|net|org|edu|gov|co|ac|me)\\.[a-z]{2}$/.test(_sfx)?2:1;` +
    `var _cid=new URLSearchParams(_l.search).get('fbclid');` +
    `if(_cid&&!_ck('_fbc'))_sc('_fbc','fb.'+_si+'.'+Date.now()+'.'+_cid);` +
    `if(!_ck('_fbp'))_sc('_fbp','fb.'+_si+'.'+Date.now()+'.'+Math.floor(Math.random()*1e10));` +
    // external_id on the browser leg. Read-only: if `numu_sid` has not been
    // written yet we send nothing rather than minting a second id, because a
    // browser id that disagrees with the server's is worse than none. The
    // effect below covers that case once getSessionFingerprint() has run.
    `window.__numu_sid=_ck('numu_sid');}catch(e){}`;

  const inits = pixelIds
    .map(
      (id) =>
        `fbq('init','${id}',window.__numu_sid?{external_id:decodeURIComponent(window.__numu_sid)}:undefined);`,
    )
    .join("");
  // Meta's official base snippet, split at exactly one seam: the method-queue
  // stub still installs synchronously (so `fbq(…)` calls made anywhere on the
  // page are captured and replayed), but injecting `fbevents.js` is hoisted
  // into `__numuLoadFbq` and handed to the interaction gate below. Meta's own
  // stub is built for precisely this — `n.queue` exists so calls can be made
  // before the SDK lands.
  const snippet =
    `!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?` +
    `n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;` +
    `n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];` +
    `f.__numuLoadFbq=function(){if(f.__numuFbqLoaded)return;f.__numuFbqLoaded=1;` +
    `t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];` +
    `s.parentNode.insertBefore(t,s);}}` +
    `(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');` +
    bootstrap +
    // Mint the initial PageView's event_id and seed window.__numu_pv so
    // <PageViewTracker>'s first-party /track POST reuses the SAME id
    // (pageViewEventId) — that's what lets CAPI dedupe the initial PageView.
    `${inits}var pvid=(self.crypto&&crypto.randomUUID)?crypto.randomUUID():Date.now()+'-'+Math.round(Math.random()*1e9);` +
    `window.__numu_pv={path:location.pathname,id:pvid};` +
    `fbq('track','PageView',{},{eventID:pvid});` +
    `window.__numuPixelIds=${JSON.stringify(pixelIds)};` +
    // Hand the SDK fetch to the interaction gate (or fire it now when the
    // merchant opted out). Everything above this line has already run.
    (loadStrategy === "immediate"
      ? `window.__numuLoadFbq();`
      : `${TP_GATE_SNIPPET}window.__numuTP(window.__numuLoadFbq);`);

  return (
    <>
      {/* Warm the connection so the deferred fetch is a single round trip once
          the gate opens. `dns-prefetch` is the cheap half and always worth it;
          the full `preconnect` is kept only on the eager path, where the
          request follows within milliseconds — holding a TLS session open for
          a fetch that may never happen is not free on a phone. */}
      <link rel="dns-prefetch" href="https://connect.facebook.net" />
      {loadStrategy === "immediate" && (
        <link rel="preconnect" href="https://connect.facebook.net" />
      )}
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
