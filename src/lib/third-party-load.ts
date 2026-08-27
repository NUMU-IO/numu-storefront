/**
 * Deferred loading for marketing-pixel SDKs (Meta, TikTok).
 *
 * ## What is deferred, and what is not
 *
 * Only the **network fetch and evaluation of the vendor SDK** moves. Everything
 * that carries measurement value still happens in the original, synchronous
 * place:
 *
 *  - the `fbq` / `ttq` method-queue stubs install immediately, so every call
 *    the page makes is captured and replayed the moment the SDK arrives;
 *  - `fbq('init')` + `fbq('track','PageView')` and `ttq.load()` + `ttq.page()`
 *    are queued immediately, with the same `event_id` they always used;
 *  - the first-party `_fbp` / `_fbc` / `ttclid` cookies are still minted inline
 *    during the first paint — they are pure `document.cookie` writes;
 *  - `<PageViewTracker>`'s first-party `/track` POST is untouched, so the
 *    **server-side** CAPI / Events API leg fires exactly as before, on time,
 *    with the shared event id. That is the leg Meta and TikTok actually
 *    deduplicate against, and it is the one that carries hashed PII.
 *
 * So a visitor who leaves without touching the page still produces a fully
 * attributed server-side PageView. What they no longer produce is the redundant
 * browser-side twin of it — the one Meta was already discarding as a duplicate.
 *
 * ## Why
 *
 * On vionneeg.com's mobile Lighthouse run the two vendor SDKs were the single
 * largest remaining cost the store actually controls:
 *
 *  - ~590 ms of main-thread time under 4× CPU throttling (Facebook 328 ms,
 *    TikTok 261 ms), charged straight to Total Blocking Time;
 *  - ~180 KiB of transfer and ~100 KiB of *unused* JavaScript;
 *  - and both scored Best-Practices failures on the report — `third-party-
 *    cookies` (weight 5 of 26) and `inspector-issues` (weight 1) — because
 *    `_ttp` and `fr` are set cross-site. Those two are the ONLY reason the
 *    category sits at 77 instead of 96.
 *
 * ## The trigger
 *
 * First genuine user input (`pointerdown` / `touchstart` / `keydown` / `wheel` /
 * `scroll`), plus a `visibilitychange → hidden` flush so a tab that is
 * backgrounded or closed still hands its queued events over. Nothing here is
 * time-based: a timer would simply move the same cost a few seconds later and
 * still land inside a Lighthouse navigation.
 *
 * ## Escape hatch
 *
 * `store.settings.tracking.pixel_load_strategy = "immediate"` restores the old
 * behaviour for a merchant who would rather have the browser-leg PageView on
 * zero-interaction sessions than the score. See `resolvePixelLoadStrategy`.
 */

export type PixelLoadStrategy = "interaction" | "immediate";

/**
 * Read the merchant's opt-out. Defaults to `"interaction"` — the deferred path
 * is what every store should want, and a store that has never heard of the
 * setting is exactly the store that benefits most.
 */
export function resolvePixelLoadStrategy(store: unknown): PixelLoadStrategy {
  const settings =
    store && typeof store === "object"
      ? (store as Record<string, unknown>).settings
      : undefined;
  const tracking =
    settings && typeof settings === "object"
      ? (settings as Record<string, unknown>).tracking
      : undefined;
  const raw =
    tracking && typeof tracking === "object"
      ? (tracking as Record<string, unknown>).pixel_load_strategy
      : undefined;
  return raw === "immediate" ? "immediate" : "interaction";
}

/**
 * JS source for `window.__numuTP(fn)` — run `fn` on the first user interaction,
 * or immediately if one already happened.
 *
 * Self-installing and idempotent, so both pixel snippets can inline it without
 * caring which of them runs first (script execution order between two
 * `afterInteractive` <Script> tags is not something to rely on). Listeners are
 * `passive` + `capture` so they never delay the interaction that triggers them,
 * and they remove themselves after the first fire.
 */
export const TP_GATE_SNIPPET =
  `window.__numuTP=window.__numuTP||function(w,d){` +
  `var q=[],done=0;` +
  `var evs=['pointerdown','touchstart','keydown','wheel','scroll'];` +
  `function off(){for(var i=0;i<evs.length;i++)w.removeEventListener(evs[i],go,{capture:true});` +
  `d.removeEventListener('visibilitychange',vis);}` +
  `function go(){if(done)return;done=1;off();` +
  `for(var i=0;i<q.length;i++){try{q[i]()}catch(e){}}q.length=0;}` +
  `function vis(){if(d.visibilityState==='hidden')go();}` +
  `for(var i=0;i<evs.length;i++)w.addEventListener(evs[i],go,{passive:true,capture:true});` +
  `d.addEventListener('visibilitychange',vis);` +
  `return function(fn){if(done){try{fn()}catch(e){}}else q.push(fn);};` +
  `}(window,document);`;
