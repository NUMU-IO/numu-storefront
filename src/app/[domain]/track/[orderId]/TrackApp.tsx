"use client";

/**
 * The Order Tracking app's view of /track/<order_id> (docs/Plans/APPS/
 * 02-order-tracking/DESIGN.md § 3). page.tsx renders it only for a store with
 * the app installed. It makes ONE request, through the app relay, and renders
 * `fallback` (core's TrackOrder, unchanged) on a 404, any other non-200, a
 * network error or no answer within 6 s.
 *
 * Store's brand, never the app's indigo: buttons, links and the current step
 * take the theme's primary colour (`primaryBrand`, resolved server-side).
 * Brand colours go in inline styles so a theme stylesheet left on the page
 * cannot override them. The frame renders at once with a skeleton and fills
 * the viewport, so nothing on screen moves when the order arrives.
 */

import { Fragment, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { toIntlDigits, toWhatsAppHref } from "@/components/storefront/WhatsAppFloat";

type StepState = "done" | "current" | "ahead";

/**
 * NUMU-api `GET …/apps/order-tracking/orders/{order_id}` (CONTRACT.md; its
 * recordings are tests/fixtures/order-tracking/shop_*.json).
 */
export interface AppOrder {
  order_number: string;
  status: string;
  /** The five route steps; returned and cancelled add their own as the sixth. */
  steps: { key: string; state: StepState; at: string | null }[];
  attempt: number | null;
  eta: { min: string; max: string } | null;
  delayed: boolean;
  delivered_at: string | null;
  carrier: { key: string; name_ar: string; name_en: string } | null;
  tracking_number: string | null;
  tracking_url: string | null;
  area: { governorate_ar?: string | null; governorate_en?: string | null; city?: string | null } | null;
  retry: { open: boolean; sent: boolean };
  show_items: boolean;
  items?: { name: string; variant?: string | null; quantity: number }[];
  total?: { amount: number; currency: string };
  show_contact: boolean;
  /** As the merchant typed them (a number or a wa.me link); `contactHref` normalises. */
  contact?: { whatsapp: string | null; phone: string | null };
}

export interface Brand {
  fill: string;
  onFill: string;
  link: string;
  radius: number;
}

export interface StoreHead {
  name: string;
  logo_url: string | null;
  country?: string;
}

type Copy = [en: string, ar: string];

const HEADLINE: Record<string, Copy> = {
  pending: ["We got your order", "استلمنا طلبك"],
  confirmed: ["Confirmed and being prepared", "طلبك اتأكد وبيتجهّز"],
  processing: ["Confirmed and being prepared", "طلبك اتأكد وبيتجهّز"],
  picked_up: ["Picked up by the courier", "المندوب استلم طلبك"],
  in_transit: ["On its way", "طلبك في الطريق"],
  out_for_delivery: ["Out for delivery today", "طلبك خارج للتوصيل النهارده"],
  delivered: ["Delivered", "طلبك اتسلّم"],
  failed: ["We couldn't deliver your order", "المندوب ماقدرش يوصّل طلبك"],
  returned: ["The order went back to the store", "الطلب رجع للمتجر"],
  cancelled: ["This order was cancelled", "الطلب اتلغى"],
};

const STEP: Record<string, Copy> = {
  confirmed: ["Confirmed", "اتأكد"],
  picked_up: ["Picked up", "المندوب استلمه"],
  in_transit: ["On its way", "في الطريق"],
  out_for_delivery: ["Out for delivery", "خارج للتوصيل"],
  delivered: ["Delivered", "اتسلّم"],
  failed: ["Not delivered", "ماتسلّمش"],
  returned: ["Returned", "رجع للمتجر"],
  cancelled: ["Cancelled", "اتلغى"],
};

/** States that show the expected-delivery line. */
const ETA_STATES = new Set(["pending", "confirmed", "processing", "picked_up", "in_transit", "out_for_delivery"]);

// Retry days ("today", "tomorrow", "after tomorrow") are calendar days in the
// store's timezone. ponytail: the store payload carries no timezone (NUMU-api
// `_PUBLIC_SETTINGS_KEYS`), so this is the platform default every store uses
// today (`store_timezone.DEFAULT_STORE_TIMEZONE`); expose `timezone` there
// when a store outside Egypt installs the app.
const TZ = "Africa/Cairo";

const DAYS: Copy[] = [
  ["Today", "النهارده"],
  ["Tomorrow", "بكرة"],
  ["After tomorrow", "بعد بكرة"],
];
// The same days inside the "sent" sentence.
const DAYS_IN_SENTENCE: Copy[] = [
  ["this", "النهارده"],
  ["tomorrow", "بكرة"],
  ["the day after tomorrow, in the", "بعد بكرة"],
];
const WINDOWS: { value: string; label: Copy; hours: string }[] = [
  { value: "morning", label: ["Morning", "الصبح"], hours: "9–12" },
  { value: "afternoon", label: ["Afternoon", "بعد الضهر"], hours: "12–5" },
  { value: "evening", label: ["Evening", "بالليل"], hours: "5–9" },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTE_MAX = 200;

/**
 * The app's view of the order, or null for core's view: not a UUID (no
 * request at all), any status but 200, a network error, a body that is not
 * the contract's, or no answer within `timeoutMs`.
 */
export async function loadAppOrder(orderId: string, timeoutMs = 6_000): Promise<AppOrder | null> {
  if (!UUID.test(orderId)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`/api/apps/order-tracking/orders/${orderId}`, {
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (res.status !== 200) {
      // An unread body keeps the request open in the browser.
      await res.body?.cancel();
      return null;
    }
    const body = await res.json();
    return body && Object.hasOwn(HEADLINE, body.status) && Array.isArray(body.steps) ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Today, tomorrow and after tomorrow as `YYYY-MM-DD` in the store's timezone. */
export function retryDays(now = new Date()): string[] {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(now)
    .split("-")
    .map(Number);
  return [0, 1, 2].map((n) => new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10));
}

/** Money as DESIGN-FAMILY § 8 writes it: `١٬٢٥٠ ج.م` / `EGP 1,250`. */
export function money(minor: number, currency: string, ar: boolean): string {
  const value = minor / 100;
  try {
    if (ar && currency === "EGP") {
      return `${new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 2 }).format(value)} ج.م`;
    }
    return new Intl.NumberFormat(ar ? "ar-EG" : "en", {
      style: "currency",
      currency,
      currencyDisplay: ar ? "symbol" : "code",
      trailingZeroDisplay: "stripIfInteger",
    }).format(value);
  } catch {
    return `${value} ${currency}`;
  }
}

/**
 * "كلّم المتجر": a wa.me chat with the order number filled in, normalised as
 * the host's WhatsApp button does; else a `tel:` link; else nothing.
 */
export function contactHref(order: AppOrder, ar: boolean, country?: string): string | null {
  if (!order.show_contact || !order.contact) return null;
  const { whatsapp, phone } = order.contact;
  const text = ar
    ? `أهلاً، بسأل عن طلبي رقم ${order.order_number}`
    : `Hi, I'm asking about my order ${order.order_number}`;
  const chat = whatsapp ? toWhatsAppHref(whatsapp, text, country) : null;
  if (chat) return chat;
  const digits = phone ? toIntlDigits(phone, country) : null;
  return digits ? `tel:+${digits}` : null;
}

/** A calendar day (`YYYY-MM-DD`), with its weekday. */
function calendarDay(day: string, ar: boolean): string {
  return new Intl.DateTimeFormat(ar ? "ar-EG" : "en-GB", {
    weekday: ar ? "long" : "short",
    day: "numeric",
    month: ar ? "long" : "short",
    timeZone: "UTC",
  }).format(new Date(`${day}T00:00:00Z`));
}

/** An instant, as a day in the store's timezone. */
function instantDay(iso: string, ar: boolean, withWeekday: boolean): string {
  return new Intl.DateTimeFormat(ar ? "ar-EG" : "en-GB", {
    ...(withWeekday ? { weekday: ar ? "long" : "short" } : {}),
    day: "numeric",
    month: ar ? "long" : "short",
    timeZone: TZ,
  }).format(new Date(iso));
}

/** The expected-delivery line, or null where DESIGN § 3 shows none. */
export function etaLine(order: AppOrder, ar: boolean): ReactNode {
  if (!ETA_STATES.has(order.status)) return null;
  if (order.eta && order.delayed) {
    const date = <bdi>{calendarDay(order.eta.max, ar)}</bdi>;
    return ar ? <>اتأخّر عن ميعاده المتوقّع ({date})</> : <>Running late; expected by {date}</>;
  }
  if (order.status === "out_for_delivery") return ar ? "متوقّع يوصلك: النهارده" : "Expected: today";
  if (!order.eta) return null;
  const min = <bdi>{calendarDay(order.eta.min, ar)}</bdi>;
  if (order.eta.min === order.eta.max) {
    return ar ? <>متوقّع يوصلك يوم {min}</> : <>Expected on {min}</>;
  }
  const max = <bdi>{calendarDay(order.eta.max, ar)}</bdi>;
  return ar ? <>متوقّع يوصلك بين {min} و{max}</> : <>Expected between {min} and {max}</>;
}

export function TrackApp({
  orderId,
  ar,
  store,
  brand,
  fallback,
}: {
  orderId: string;
  ar: boolean;
  store: StoreHead;
  brand: Brand;
  fallback: ReactNode;
}) {
  // undefined: loading; null: show core's view.
  const [order, setOrder] = useState<AppOrder | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    loadAppOrder(orderId).then((found) => {
      if (live) setOrder(found);
    });
    return () => {
      live = false;
    };
  }, [orderId]);

  if (order === null) return <>{fallback}</>;
  return <TrackAppView order={order} orderId={orderId} ar={ar} store={store} brand={brand} />;
}

/** The view; `order` undefined renders the loading frame. */
export function TrackAppView({
  order,
  orderId,
  ar,
  store,
  brand,
}: {
  order: AppOrder | undefined;
  orderId: string;
  ar: boolean;
  store: StoreHead;
  brand: Brand;
}) {
  const t = ([en, arText]: Copy) => (ar ? arText : en);
  const box: CSSProperties = { borderRadius: brand.radius };

  return (
    <main
      dir={ar ? "rtl" : "ltr"}
      lang={ar ? "ar" : "en"}
      aria-busy={order ? undefined : true}
      className="min-h-svh bg-white text-[#111111]"
    >
      {/* pb-56 lets the last button scroll clear of the store's WhatsApp
          float, which sits up to 216 px from the bottom when raised. */}
      <div className="mx-auto max-w-[560px] px-4 pt-8 pb-56">
        <div className="mb-6 flex items-center gap-3">
          {store.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={store.logo_url} alt={store.name} className="h-9 w-9 rounded-lg object-contain" />
          ) : (
            <span
              aria-hidden="true"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-sm font-bold"
              style={{ background: brand.fill, color: brand.onFill }}
            >
              {store.name?.[0] || "·"}
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{store.name}</span>
          <a
            href={`?locale=${ar ? "en" : "ar"}`}
            hrefLang={ar ? "en" : "ar"}
            lang={ar ? "en" : "ar"}
            className="inline-flex min-h-11 items-center px-1 text-sm font-semibold underline underline-offset-4"
            style={{ color: brand.link }}
          >
            {ar ? "English" : "عربي"}
          </a>
        </div>

        {order ? (
          <OrderStatus order={order} orderId={orderId} ar={ar} store={store} brand={brand} />
        ) : (
          <>
            <p role="status" className="sr-only">
              {t(["Loading your order…", "بنحمّل طلبك…"])}
            </p>
            <div aria-hidden="true" className="animate-pulse motion-reduce:animate-none">
              <div className="h-4 w-24 bg-gray-100" style={box} />
              <div className="mt-3 h-8 w-3/4 bg-gray-100" style={box} />
              <div className="mt-3 h-4 w-1/2 bg-gray-100" style={box} />
              <div className="mt-8 h-16 bg-gray-100" style={box} />
              <div className="mt-6 h-4 w-2/3 bg-gray-100" style={box} />
              <div className="mt-6 h-28 bg-gray-100" style={box} />
              <div className="mt-6 h-11 bg-gray-100" style={box} />
            </div>
          </>
        )}
      </div>
    </main>
  );
}

const ALREADY_SENT: Copy = [
  "We sent your request to the store a little while ago. If you need anything, contact the store.",
  "بعتنا طلبك للمتجر من شوية. لو محتاج حاجة كلّم المتجر.",
];

type RetryOutcome = "sent" | "already_sent" | "moved_on" | "other_day" | "too_many" | "failed";

const RETRY_ERROR: Record<Exclude<RetryOutcome, "sent" | "already_sent">, Copy> = {
  moved_on: ["Your order's status has changed. Refresh the page to see it.", "حالة طلبك اتغيّرت. حدّث الصفحة عشان تشوفها."],
  other_day: ["That day isn't available any more. Pick another one.", "اليوم ده مبقاش متاح. اختار يوم تاني."],
  too_many: ["Too many tries. Wait a minute and try again.", "محاولات كتير. استنى دقيقة وجرّب تاني."],
  failed: ["We couldn't send that right now. Try again in a minute.", "مش قادرين نبعت طلبك دلوقتي. جرّب تاني بعد دقيقة."],
};

/**
 * What NUMU-api's answer to "Try again" means (CONTRACT.md). Its own answers
 * are flat, `{"code": "already_sent", "detail": …}`; a day outside the next
 * three is `422 {"detail": "…"}`; what FastAPI raises comes as
 * `{"success": false, "error": {"code", "message"}}`, and the rate limiter's
 * 429 as `{"success": false, "error": "…", "code": "RATE_LIMIT_EXCEEDED"}`.
 */
export function retryOutcome(status: number, body: unknown): RetryOutcome {
  const b = (body && typeof body === "object" ? body : {}) as { code?: unknown; detail?: unknown; error?: unknown };
  const code = b.code ?? (b.error && typeof b.error === "object" ? (b.error as { code?: unknown }).code : undefined);
  if (status >= 200 && status < 300) return "sent";
  if (status === 409 && code === "already_sent") return "already_sent";
  // The parcel moved on (delivered, say) since the page loaded.
  if (status === 409 && code === "not_failed") return "moved_on";
  // The store's calendar and Cairo's (the days offered) disagree near midnight.
  if (status === 422 && typeof b.detail === "string") return "other_day";
  if (status === 429) return "too_many";
  return "failed";
}

function OrderStatus({
  order,
  orderId,
  ar,
  store,
  brand,
}: {
  order: AppOrder;
  orderId: string;
  ar: boolean;
  store: StoreHead;
  brand: Brand;
}) {
  const t = ([en, arText]: Copy) => (ar ? arText : en);
  // The answer to this visit's "Try again", shown in place of the form.
  const [result, setResult] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const filled: CSSProperties = { background: brand.fill, color: brand.onFill, borderRadius: brand.radius };
  const outline: CSSProperties = { border: `2px solid ${brand.link}`, color: brand.link, borderRadius: brand.radius };
  const box: CSSProperties = { borderRadius: brand.radius };

  const steps = order.steps.filter((s) => Object.hasOwn(STEP, s.key));
  const carrierName = order.carrier ? (ar ? order.carrier.name_ar : order.carrier.name_en) : null;
  const trackingUrl = order.tracking_url && /^https?:\/\//i.test(order.tracking_url) ? order.tracking_url : null;
  // City and governorate are isolated apart: a city typed in Arabic must not
  // turn an English line's order around.
  const area = order.area
    ? [order.area.city, ar ? order.area.governorate_ar || order.area.governorate_en : order.area.governorate_en || order.area.governorate_ar]
        .filter((part): part is string => Boolean(part))
        .map((part, i) => (
          <Fragment key={i}>
            {i > 0 && (ar ? "، " : ", ")}
            <bdi>{part}</bdi>
          </Fragment>
        ))
    : [];
  const contact = contactHref(order, ar, store.country);
  const canRetry = order.status === "failed" && order.retry.open && !result;
  const sentEarlier = order.status === "failed" && order.retry.sent && !order.retry.open;
  const eta = etaLine(order, ar);
  const showItems = order.show_items && ((order.items?.length ?? 0) > 0 || order.total);

  let sub: ReactNode = null;
  if (order.status === "out_for_delivery") {
    sub = t(["Keep your phone close; the courier will call you.", "خلّي موبايلك جنبك، المندوب هيكلّمك."]);
  } else if (order.status === "delivered" && order.delivered_at) {
    sub = <bdi>{instantDay(order.delivered_at, ar, true)}</bdi>;
  } else if (order.status === "failed" && order.attempt) {
    sub = ar ? `المحاولة رقم ${new Intl.NumberFormat("ar-EG").format(order.attempt)}` : `Attempt ${order.attempt}`;
  }

  return (
    <>
      <p className="text-sm text-gray-600">
        {t(["Order", "طلب رقم"])} <bdi dir="ltr">#{order.order_number}</bdi>
      </p>
      <h1 className="mt-1 text-2xl font-bold leading-snug">{t(HEADLINE[order.status])}</h1>
      {sub && <p className="mt-2 text-base text-gray-700">{sub}</p>}

      <ol className="mt-8 flex" aria-label={t(["Delivery steps", "خطوات التوصيل"])}>
        {steps.map((s, i) => {
          const next = steps[i + 1];
          const dot: CSSProperties =
            s.state === "done"
              ? { background: brand.fill, borderColor: brand.fill, color: brand.onFill }
              : s.state === "current"
                ? { background: "#ffffff", borderColor: brand.fill, boxShadow: `0 0 0 4px ${brand.fill}33` }
                : { background: "#ffffff", borderColor: "#9ca3af" };
          return (
            <li
              key={s.key}
              aria-current={s.state === "current" ? "step" : undefined}
              className="relative flex flex-1 flex-col items-center px-0.5 text-center"
            >
              {next && (
                <span
                  aria-hidden="true"
                  className="absolute start-1/2 top-[11px] h-0.5 w-full"
                  style={{ background: next.state === "ahead" ? "#d1d5db" : brand.fill }}
                />
              )}
              <span
                aria-hidden="true"
                className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full border-2"
                style={dot}
              >
                {s.state === "done" && (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </span>
              <span className="mt-2 text-xs font-semibold leading-tight">
                {t(STEP[s.key])}
                {s.state !== "current" && (
                  <span className="sr-only">
                    {s.state === "done" ? t([" (done)", " (خلص)"]) : t([" (not yet)", " (لسه)"])}
                  </span>
                )}
              </span>
              {s.at && s.state !== "ahead" && (
                <span className="mt-0.5 text-[11px] text-gray-600">
                  <bdi>{instantDay(s.at, ar, false)}</bdi>
                </span>
              )}
            </li>
          );
        })}
      </ol>

      {eta && <p className="mt-6 text-sm font-medium">{eta}</p>}

      {(carrierName || order.tracking_number || trackingUrl || area.length > 0) && (
        <div className="mt-6 space-y-1 border border-gray-200 p-4 text-sm" style={box}>
          {carrierName && (
            <p>
              {t(["Carrier: ", "شركة الشحن: "])}
              {carrierName}
            </p>
          )}
          {order.tracking_number && (
            <p>
              {t(["Tracking number ", "رقم التتبّع "])}
              <bdi dir="ltr" className="font-mono font-semibold">
                {order.tracking_number}
              </bdi>
            </p>
          )}
          {trackingUrl && (
            <a
              href={trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1 font-semibold underline underline-offset-4"
              style={{ color: brand.link }}
            >
              {carrierName
                ? ar
                  ? `تابع على موقع ${carrierName}`
                  : `Track on ${carrierName}`
                : t(["Track the parcel", "تابع الشحنة"])}
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="rtl:-scale-x-100">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </a>
          )}
          {area.length > 0 && (
            <p>
              {t(["Delivering to: ", "التوصيل في: "])}
              {area}
            </p>
          )}
        </div>
      )}

      {showItems && (
        <section className="mt-6 border border-gray-200 p-4 text-sm" style={box} aria-labelledby="trk-items">
          <h2 id="trk-items" className="font-semibold">
            {t(["Items", "المنتجات"])}
          </h2>
          {order.items?.length ? (
            <ul className="mt-1 divide-y divide-gray-100">
              {order.items.map((item, i) => (
                <li key={i} className="flex justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <bdi>{item.name}</bdi>
                    {item.variant && <span className="text-gray-600"> · <bdi>{item.variant}</bdi></span>}
                  </span>
                  <span className="shrink-0 text-gray-600">
                    × <bdi dir="ltr">{item.quantity}</bdi>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {order.total && (
            <p className="mt-1 flex justify-between gap-3 border-t border-gray-100 pt-2 font-semibold">
              <span>{t(["Total", "الإجمالي"])}</span>
              <bdi>{money(order.total.amount, order.total.currency, ar)}</bdi>
            </p>
          )}
        </section>
      )}

      {(result || sentEarlier) && (
        <p
          role="status"
          // Focus follows the shopper's own send; never on page load.
          ref={result ? (el) => el?.focus() : undefined}
          tabIndex={result ? -1 : undefined}
          className="mt-6 border border-gray-200 bg-gray-50 p-4 text-sm"
          style={box}
        >
          {result ?? t(ALREADY_SENT)}
        </p>
      )}

      {(canRetry || contact) && (
        <div className="mt-6 flex flex-wrap gap-3">
          {canRetry && (
            <button
              type="button"
              aria-expanded={open}
              aria-controls="trk-retry"
              onClick={() => setOpen(!open)}
              className="inline-flex min-h-11 flex-1 basis-40 items-center justify-center px-5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111111]"
              style={filled}
            >
              {t(["Try again", "حاول تاني"])}
            </button>
          )}
          {contact && (
            <a
              href={contact}
              rel="noreferrer"
              className="inline-flex min-h-11 flex-1 basis-40 items-center justify-center px-5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111111]"
              style={canRetry ? outline : filled}
            >
              {t(["Contact the store", "كلّم المتجر"])}
            </a>
          )}
        </div>
      )}

      {canRetry && open && (
        <RetryForm
          orderId={orderId}
          ar={ar}
          brand={brand}
          onDone={(message) => {
            setResult(message);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

/** The "Try again" panel; `onDone` gets the sentence to show in its place. */
export function RetryForm({
  orderId,
  ar,
  brand,
  now,
  onDone,
}: {
  orderId: string;
  ar: boolean;
  brand: Brand;
  /** The moment the retry days count from (tests). */
  now?: Date;
  onDone: (message: string) => void;
}) {
  const t = ([en, arText]: Copy) => (ar ? arText : en);
  const [days] = useState(() => retryDays(now));
  const [day, setDay] = useState(1);
  const [slot, setSlot] = useState(1);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const box: CSSProperties = { borderRadius: brand.radius };

  async function send(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // The API refuses control characters; a pasted tab or newline is a space.
    const clean = note.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    try {
      const res = await fetch(`/api/apps/order-tracking/orders/${orderId}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day: days[day], window: WINDOWS[slot].value, ...(clean ? { note: clean } : {}) }),
      });
      const outcome = retryOutcome(res.status, res.ok ? null : await res.json().catch(() => null));
      if (outcome === "sent") {
        const when = ar
          ? `${DAYS_IN_SENTENCE[day][1]} ${WINDOWS[slot].label[1]}`
          : `${DAYS_IN_SENTENCE[day][0]} ${WINDOWS[slot].label[0].toLowerCase()}`;
        onDone(
          ar
            ? `تمام! بلّغنا المتجر إنك عايز تستلم ${when}. هيكلّموك يأكّدوا الميعاد.`
            : `Done. We told the store you'd like it ${when}. They'll call to confirm.`,
        );
        return;
      }
      if (outcome === "already_sent") {
        onDone(t(ALREADY_SENT));
        return;
      }
      setError(t(RETRY_ERROR[outcome]));
    } catch {
      setError(t(RETRY_ERROR.failed));
    } finally {
      setBusy(false);
    }
  }

  const option = (checked: boolean): CSSProperties => ({
    ...box,
    borderColor: checked ? brand.link : "#d1d5db",
    boxShadow: checked ? `inset 0 0 0 1px ${brand.link}` : undefined,
  });

  return (
    <form id="trk-retry" onSubmit={send} className="mt-4 space-y-5 border border-gray-200 p-4" style={box}>
      <h2 className="text-base font-semibold">{t(["Want us to try delivering it again?", "عايز نحاول نوصّله تاني؟"])}</h2>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t(["Day", "اليوم"])}</legend>
        <div className="flex flex-wrap gap-2">
          {days.map((d, i) => (
            <label key={d} className="flex min-h-11 flex-1 basis-24 cursor-pointer items-center gap-2 border px-3 py-1.5 text-sm" style={option(day === i)}>
              <input
                type="radio"
                name="trk-day"
                value={d}
                checked={day === i}
                onChange={() => setDay(i)}
                className="h-4 w-4 shrink-0"
                style={{ accentColor: brand.link }}
              />
              <span className="flex flex-col leading-tight">
                <span className="font-semibold">{t(DAYS[i])}</span>
                <span className="text-xs text-gray-600">
                  <bdi>{calendarDay(d, ar)}</bdi>
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-semibold">{t(["Time", "الوقت"])}</legend>
        <div className="flex flex-wrap gap-2">
          {WINDOWS.map((w, i) => (
            <label key={w.value} className="flex min-h-11 flex-1 basis-24 cursor-pointer items-center gap-2 border px-3 py-1.5 text-sm" style={option(slot === i)}>
              <input
                type="radio"
                name="trk-window"
                value={w.value}
                checked={slot === i}
                onChange={() => setSlot(i)}
                className="h-4 w-4 shrink-0"
                style={{ accentColor: brand.link }}
              />
              <span>
                <span className="font-semibold">{t(w.label)}</span> <bdi dir="ltr">{w.hours}</bdi>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="trk-note" className="mb-1.5 block text-sm font-semibold">
          {t(["Note for the courier (optional)", "ملاحظة للمندوب (اختياري)"])}
        </label>
        <input
          id="trk-note"
          type="text"
          maxLength={NOTE_MAX}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t(["A landmark near the address…", "علامة مميزة جنب العنوان…"])}
          aria-describedby="trk-note-count"
          className="block min-h-11 w-full border border-gray-400 bg-white px-3 text-sm"
          style={box}
        />
        <p id="trk-note-count" className="mt-1 text-end text-xs text-gray-600">
          <bdi dir="ltr">
            {note.length}/{NOTE_MAX}
          </bdi>
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={busy}
        className="inline-flex min-h-11 w-full items-center justify-center px-5 text-sm font-semibold disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111111]"
        style={{ background: brand.fill, color: brand.onFill, borderRadius: brand.radius }}
      >
        {t(["Send to the store", "ابعت للمتجر"])}
      </button>
    </form>
  );
}
