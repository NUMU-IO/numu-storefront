"use client";

/**
 * Promotion popup (offers-v2 surface) — host-rendered overlay. Honors the
 * display trigger (on_delay / on_scroll_pct / on_exit_intent / on_add_to_cart
 * defer the open; on_load / always open at first paint), an optional
 * email-capture form that reveals a discount code on submit, and per-visitor
 * dismissal via the ✕ or Escape. Mirrors V2's PopupModal, self-contained like
 * AnnouncementBar.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ResolvedPromotion } from "@/lib/promo-server";
import { trackFunnel, getSessionFingerprint } from "@/lib/meta-pixel";
import { identifyShopper } from "@/lib/meta-identity";
import {
  postPromo,
  submitPromoForm,
  isPromoDismissed,
  markPromoDismissed,
  pickBi,
  promoCtaHref,
} from "@/lib/promo-client";

interface PopupContent {
  layout?: "centered" | "side" | "custom" | string;
  image_url?: string | null;
  discount_code_to_reveal?: string | null;
  form_fields?: string[];
  show_after_dismiss_days?: number;
  /** Merchant-authored HTML rendered when layout === "custom". */
  custom_html?: string | null;
  auto_apply_code?: string | null;
}
interface Display {
  trigger?: string;
  trigger_value?: { delay_ms?: number; scroll_pct?: number };
}

/**
 * Triggers that hold the popup back until the visitor does something. Keep in
 * lockstep with the branches in the trigger effect below — everything the
 * effect does NOT branch on falls through to an immediate `show()`.
 */
const DEFERRED_TRIGGERS = new Set([
  "on_delay",
  "on_scroll_pct",
  "on_exit_intent",
  "on_add_to_cart",
]);

/**
 * Does this trigger put the popup on screen at first paint?
 *
 * Exported because PromoMounts has to answer the same question to decide
 * whether to mount the popup at all on routes where a full-viewport overlay
 * covers the only control the visitor came for. It used to answer it on its
 * own with `trigger === "on_load"`, and that quietly matched nothing: the
 * backend's DisplayTrigger enum also carries `always` and `on_add_to_cart`,
 * and every promotion seeded through the merchant hub is stored as `always`.
 * So the route suppression list was inert on every real store — the popup
 * still landed on /search, /track and /cart — while looking correct in review.
 *
 * `always` is grouped with `on_load` because that is literally what the effect
 * below does with it. `on_add_to_cart` is NOT: it waits for the SDK's
 * add-to-cart event, so it belongs with the deferred triggers and the route
 * list must let it mount — a popup that opens only once the shopper has put
 * something in the cart is an intent-driven moment (the /cart route is where
 * it is most useful), not an interstitial thrown at a page on arrival.
 * Encoding the real behaviour in one place is what keeps the two components
 * from drifting apart again.
 */
export function popupOpensAtFirstPaint(
  trigger: string | null | undefined,
): boolean {
  return !DEFERRED_TRIGGERS.has(trigger || "on_load");
}

export function PopupModal({
  promotion,
  locale = "ar",
}: {
  promotion: ResolvedPromotion;
  locale?: string;
}) {
  const isAr = locale === "ar";
  const content = (promotion.content ?? {}) as PopupContent;
  const display = (promotion.display ?? {}) as Display;
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fired = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isPromoDismissed(promotion.promotion_id)) return;
    const show = () => {
      if (fired.current) return;
      fired.current = true;
      setOpen(true);
      postPromo(promotion.promotion_id, "events", {
        event_type: "impression",
        metadata: { surface: "popup" },
      });
    };
    const trigger = display.trigger || "on_load";
    if (trigger === "on_delay") {
      const t = setTimeout(show, Number(display.trigger_value?.delay_ms) || 3000);
      return () => clearTimeout(t);
    }
    if (trigger === "on_scroll_pct") {
      const target = Number(display.trigger_value?.scroll_pct) || 50;
      const onScroll = () => {
        const max = document.body.scrollHeight - window.innerHeight || 1;
        if ((window.scrollY / max) * 100 >= target) show();
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      return () => window.removeEventListener("scroll", onScroll);
    }
    if (trigger === "on_exit_intent") {
      const onLeave = (e: MouseEvent) => {
        if (e.clientY <= 0) show();
      };
      document.addEventListener("mouseout", onLeave);
      return () => document.removeEventListener("mouseout", onLeave);
    }
    if (trigger === "on_add_to_cart") {
      /**
       * The add-to-cart signal already in this codebase: the SDK's cart
       * `addItem` dispatches `numu:analytics:event` with `event:"add_to_cart"`
       * after a SUCCESSFUL write (a rejected add fires nothing), and the host's
       * <MetaPixel>/<TikTokPixel> bridges listen to that exact event. Reusing
       * it means the popup opens on the same moment the ad platforms record an
       * AddToCart, instead of on a second signal that could drift from it.
       *
       * Known gap, deliberately left as a no-show rather than a wrong-moment
       * show: the host's own built-in product page (BuiltInProductDetail, the
       * fallback for a store with no external theme) POSTs /api/cart/add and
       * announces only `numu:cart:updated`, which also fires on remove and on
       * quantity edits. Opening a popup when a shopper EMPTIES their cart is
       * the very failure this branch exists to remove, so we do not subscribe
       * to it — on those stores the trigger simply never fires.
       */
      const onAnalytics = (e: Event) => {
        const detail = (e as CustomEvent<{ event?: string }>).detail;
        if (detail?.event === "add_to_cart") show();
      };
      window.addEventListener(
        "numu:analytics:event",
        onAnalytics as EventListener,
      );
      return () =>
        window.removeEventListener(
          "numu:analytics:event",
          onAnalytics as EventListener,
        );
    }
    show();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Declared above the `!open` early return so the keyboard effect below can
  // depend on it, and memoised so that effect isn't torn down and re-run (which
  // would bounce focus) on every unrelated re-render.
  const close = useCallback(() => {
    const days = content.show_after_dismiss_days ?? 30;
    postPromo(promotion.promotion_id, "events", {
      event_type: "dismiss",
      metadata: { surface: "popup" },
    });
    postPromo(promotion.promotion_id, "dismiss", { remember_for_days: days });
    markPromoDismissed(promotion.promotion_id, days);
    setOpen(false);
  }, [content.show_after_dismiss_days, promotion.promotion_id]);

  /**
   * Keyboard + focus contract for `role="dialog" aria-modal="true"`.
   *
   * That pair of attributes promises assistive tech the rest of the page is
   * inert, and the markup was only keeping half of it: the ✕ was the single
   * way out, so a keyboard or screen-reader visitor had neither a way to
   * dismiss the popup nor a way to reach the page behind it — a keyboard trap
   * (WCAG 2.1.2) on every route the popup fires on.
   *
   * Escape routes through the very same `close()` the ✕ calls rather than just
   * flipping `open`, so it reports the dismiss event and writes the
   * `numu_promo_dismissed_<id>` record too. Both exits have to leave identical
   * state or the visitor who escapes out gets interrupted again on every
   * subsequent page.
   *
   * Focus moves into the dialog on open, cycles inside it on Tab, and returns
   * to whatever held it before on close. One acknowledged gap: in the
   * custom-HTML layout the content is a sandboxed iframe, and keydowns raised
   * inside another document never reach this listener, so Tab can walk out the
   * far side of that one. Reaching across the sandbox boundary to fix it would
   * defeat the point of the sandbox, so it stays a known limit rather than a
   * pretend fix.
   */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !dialog) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])',
        ),
      );

    // The dialog itself is focusable (tabIndex -1) so a popup whose only
    // content is text still hands focus to something inside the modal.
    (focusables()[0] ?? dialog).focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables();
      const first = items[0] ?? dialog;
      const last = items[items.length - 1] ?? dialog;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Skip detached nodes: on a route change the element that had focus is
      // usually gone with the old page, and focusing it would be a no-op that
      // silently drops the caret to <body>.
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [open, close]);

  if (!open) return null;

  // Custom-HTML mode: the merchant pasted their own markup (e.g. AI-generated).
  // Rendered in a sandboxed iframe below — no scripts, no access to the parent
  // page / cookies — so untrusted HTML can't run code against shoppers.
  const isCustom =
    content.layout === "custom" && !!content.custom_html?.trim();

  // Wrap the merchant/AI snippet in a minimal document so the iframe body has
  // no default 8px margin (which showed as a white gutter around the design)
  // and the root can fill the full height. The snippet's own root element owns
  // the background edge-to-edge, so the modal reads as one intentional card
  // instead of a dark box floating on white.
  const customDoc = isCustom
    ? `<!doctype html><html dir="${isAr ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;padding:0;height:100%}body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif}</style></head><body>${content.custom_html ?? ""}</body></html>`
    : "";

  const headline = pickBi(promotion.translated_content, "headline", isAr);
  const body = pickBi(promotion.translated_content, "body", isAr);
  const ctaLabel = pickBi(promotion.translated_content, "cta_label", isAr);
  const ctaUrl = (promotion.translated_content as { cta_url?: string })?.cta_url;
  const wantsEmail =
    Array.isArray(content.form_fields) && content.form_fields.includes("email");
  const code =
    revealed ?? content.discount_code_to_reveal ?? promotion.coupon_code ?? null;

  /**
   * Accessible name for the `role="dialog"` container.
   *
   * `aria-modal="true"` tells assistive tech the rest of the page is inert, and
   * the only thing it can then announce is the dialog's own name — with neither
   * `aria-labelledby` nor `aria-label` a screen reader read out a bare, unnamed
   * "dialog" on every store running a popup, giving the visitor nothing to
   * decide on before they are trapped inside it.
   *
   * Prefer the merchant's headline (the visible name — WCAG 2.5.3), falling
   * back to a generic label for the two layouts that have no headline element
   * to point at: the custom-HTML variant, whose content lives inside a
   * sandboxed iframe this document cannot reference across, and a headline-less
   * popup (body / image / code only). Exactly one of the two attributes is ever
   * set, so `aria-labelledby` can never point at an id that wasn't rendered.
   */
  const headlineId = `numu-promo-${promotion.promotion_id}-title`;
  const labelledBy = !isCustom && headline ? headlineId : undefined;
  const fallbackLabel = labelledBy
    ? undefined
    : isAr
      ? "عرض ترويجي"
      : "Promotion";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || busy) return;
    setBusy(true);
    const out = await submitPromoForm(promotion.promotion_id, {
      email,
      accepts_marketing: true,
    });
    setBusy(false);
    setRevealed(out?.discount_code ?? content.discount_code_to_reveal ?? "");

    // An email capture is a Lead, and `lead` has been mapped end-to-end
    // (browser + CAPI) the whole time with nothing ever emitting it — so the
    // one moment a shopper voluntarily hands over an email produced no signal
    // at all. Recording the identity first means this Lead, and every event
    // after it in the session, carries a hashed `em`.
    //
    // `accepts_marketing: true` above is the consent this relies on.
    identifyShopper({ email }, getSessionFingerprint());
    trackFunnel("lead", {
      content_name: promotion.promotion_id,
      content_category: "promo_popup",
    });
  };

  return (
    // `tabIndex={-1}` makes this a programmatic focus target only — it is the
    // fallback the focus effect uses for a popup with no focusable content, and
    // there is no keyboard path to it, so `outline-none` suppresses what would
    // otherwise be a focus ring drawn around the whole viewport.
    <div
      ref={dialogRef}
      tabIndex={-1}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 outline-none"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-label={fallbackLabel}
      dir={isAr ? "rtl" : "ltr"}
    >
      <div className="absolute inset-0 bg-black/50" onClick={close} aria-hidden />
      <div
        className={`relative w-full overflow-hidden rounded-2xl bg-white shadow-xl ${
          isCustom ? "max-w-lg" : "max-w-md"
        }`}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute end-3 top-3 z-10 rounded-full bg-white/80 p-1.5 text-gray-500 hover:bg-gray-100"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
        </button>
        {isCustom ? (
          // Untrusted markup — `sandbox` without `allow-scripts` blocks JS and
          // isolates it from the storefront origin. `allow-popups` +
          // `allow-top-navigation-by-user-activation` let a CTA link navigate
          // on a real click without granting script access.
          <iframe
            title="promotion"
            sandbox="allow-popups allow-top-navigation-by-user-activation"
            srcDoc={customDoc}
            className="block h-[540px] max-h-[75vh] w-full border-0"
          />
        ) : (
          <>
        {content.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={content.image_url} alt="" className="h-40 w-full object-cover" />
        )}
        <div className="p-6 text-center">
          {headline && (
            <h2
              id={headlineId}
              className="mb-2 text-xl font-semibold text-gray-900"
            >
              {headline}
            </h2>
          )}
          {body && <p className="mb-4 text-sm text-gray-600">{body}</p>}
          {code ? (
            <div className="mb-1 rounded-lg border border-dashed border-emerald-300 bg-emerald-50 px-4 py-3">
              <p className="text-xs text-emerald-700">
                {isAr ? "كود الخصم" : "Your code"}
              </p>
              <p className="select-all font-mono text-lg font-bold text-emerald-800" dir="ltr">
                {code}
              </p>
            </div>
          ) : wantsEmail ? (
            <form onSubmit={submit} className="space-y-2">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={isAr ? "البريد الإلكتروني" : "Email"}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                dir="ltr"
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-50"
              >
                {busy ? "…" : ctaLabel || (isAr ? "اشترك" : "Subscribe")}
              </button>
            </form>
          ) : ctaUrl || ctaLabel ? (
            // Show the merchant's CTA whenever they set a label OR a URL.
            // With a URL it's a link; a label-only CTA acts as an
            // acknowledge button that closes the popup (previously a
            // label without a URL rendered no button at all).
            ctaUrl ? (
              <a
                href={promoCtaHref(ctaUrl, content.auto_apply_code) ?? ctaUrl}
                onClick={() =>
                  postPromo(promotion.promotion_id, "events", {
                    event_type: "click",
                    metadata: { surface: "popup" },
                  })
                }
                className="inline-block rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
              >
                {ctaLabel || (isAr ? "تسوّق الآن" : "Shop now")}
              </a>
            ) : (
              <button
                type="button"
                onClick={() => {
                  postPromo(promotion.promotion_id, "events", {
                    event_type: "click",
                    metadata: { surface: "popup" },
                  });
                  close();
                }}
                className="inline-block rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-gray-800"
              >
                {ctaLabel}
              </button>
            )
          ) : null}
        </div>
          </>
        )}
      </div>
    </div>
  );
}
