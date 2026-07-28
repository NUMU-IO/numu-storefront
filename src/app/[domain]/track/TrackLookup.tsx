"use client";

/**
 * Guest order lookup — the form half of /track. Trades an order number plus
 * ONE contact key (the phone or the email used at checkout) for the order id,
 * then routes to `track/{orderId}`, which is the page that actually renders
 * the status timeline. Guest-accessible, no auth. Bilingual (en + Egyptian
 * Arabic), RTL-safe, styled to match its sibling `TrackOrder`.
 *
 * Security posture: the backend answers a wrong order number and a wrong
 * contact key with the SAME 404, and this component shows ONE neutral message
 * for it. Never split that into "no such order" vs "wrong phone" — the pair is
 * the only thing standing between a scraper and enumerable order numbers.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Egyptian mobile in local form: 01 + operator digit + 8 subscriber digits. */
const EG_MOBILE_RE = /^01\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Reduce whatever the shopper typed to the `01xxxxxxxxx` local form the
 * platform stores. Confirmation emails and WhatsApp show the number in mixed
 * shapes (`+20 106 …`, `0020106…`, spaced, dashed), so a strict compare
 * against the raw input would reject the customer's own number.
 */
function normalizeEgPhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("0020")) return `0${digits.slice(4)}`;
  if (digits.startsWith("20") && digits.length === 12) return `0${digits.slice(2)}`;
  return digits;
}

type ContactKey = "phone" | "email";

export function TrackLookup({
  domain,
  initialOrderNumber,
}: {
  domain: string;
  initialOrderNumber: string;
}) {
  const router = useRouter();
  // The CTA passes the number exactly as printed on the confirmation ("#1042"),
  // while the backend stores it without the sigil — strip it on the way in.
  const [orderNumber, setOrderNumber] = useState(
    initialOrderNumber.trim().replace(/^#/, ""),
  );
  const [contactKey, setContactKey] = useState<ContactKey>("phone");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAr, setIsAr] = useState(false);
  const T = (en: string, ar: string) => (isAr ? ar : en);

  // Same locale signal as TrackOrder: the root layout stamps <html lang> from
  // the proxy-resolved visitor locale, so the DOM is the single source here and
  // no extra fetch is needed.
  useEffect(() => {
    if (typeof document !== "undefined")
      setIsAr(document.documentElement.lang === "ar");
  }, []);

  const dir = isAr ? "rtl" : "ltr";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const number = orderNumber.trim().replace(/^#/, "");
    if (!number) {
      setError(T("Enter your order number.", "اكتب رقم الطلب."));
      return;
    }

    // Validate the contact key before the round trip: a malformed phone would
    // come back as the same neutral 404 as a wrong one, which reads to the
    // shopper as "your order doesn't exist" instead of "fix the number".
    let normalizedPhone: string | null = null;
    let normalizedEmail: string | null = null;
    if (contactKey === "phone") {
      normalizedPhone = normalizeEgPhone(phone);
      if (!EG_MOBILE_RE.test(normalizedPhone)) {
        setError(
          T(
            "Enter the Egyptian mobile number you ordered with (11 digits, starts with 01).",
            "اكتب رقم الموبايل المصري اللي طلبت بيه (11 رقم ويبدأ بـ 01).",
          ),
        );
        return;
      }
    } else {
      normalizedEmail = email.trim();
      if (!EMAIL_RE.test(normalizedEmail)) {
        setError(
          T("Enter a valid email address.", "اكتب بريد إلكتروني صحيح."),
        );
        return;
      }
    }

    setBusy(true);
    setError(null);
    let navigated = false;
    try {
      const res = await fetch("/api/storefront/track-lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_number: number,
          phone: normalizedPhone,
          email: normalizedEmail,
        }),
        cache: "no-store",
      });
      if (!res.ok) {
        // 404 = no order matches the (number, key) pair — deliberately the
        // same answer whichever half is wrong. Anything else is our fault,
        // not the shopper's, so say so rather than implying the order is gone.
        setError(
          res.status === 404
            ? T(
                "We couldn't find an order matching those details. Check the order number and the phone or email you used at checkout.",
                "مش لاقيين طلب بالبيانات دي. راجع رقم الطلب والموبايل أو الإيميل اللي استخدمته وقت الشراء.",
              )
            : T(
                "Something went wrong. Try again in a moment.",
                "حصلت مشكلة. جرّب تاني بعد لحظات.",
              ),
        );
        return;
      }
      const json = await res.json();
      // The backend wraps SuccessResponse payloads in `{ data }` but some
      // storefront endpoints answer with the bare model — accept `order_id`
      // from either level rather than betting on one.
      const orderId: unknown = json?.data?.order_id ?? json?.order_id;
      if (typeof orderId !== "string" || !orderId) {
        setError(
          T(
            "Something went wrong. Try again in a moment.",
            "حصلت مشكلة. جرّب تاني بعد لحظات.",
          ),
        );
        return;
      }
      // Path-segment mode (dev / direct-IP): the live URL carries the
      // `/<domain>` prefix, so keep it or the push escapes the store. On a
      // store subdomain (production) the root path IS the store path. Same
      // rule as SoftNavBridge — reading location is the only reliable signal
      // for which addressing mode the document is on.
      const inPathMode =
        window.location.pathname === `/${domain}` ||
        window.location.pathname.startsWith(`/${domain}/`);
      const target = `/track/${orderId}`;
      navigated = true;
      router.push(inPathMode ? `/${domain}${target}` : target);
    } catch {
      setError(
        T(
          "Something went wrong. Try again in a moment.",
          "حصلت مشكلة. جرّب تاني بعد لحظات.",
        ),
      );
    } finally {
      // Stay busy through the route transition: re-enabling the button while
      // the push is in flight invites a second submit that races the first.
      if (!navigated) setBusy(false);
    }
  }

  const errorId = "track-lookup-error";
  const describedBy = error ? errorId : undefined;

  return (
    // No `min-h-screen`: this div is `#main > div`, and globals.css already
    // hands it the viewport's LEFTOVER height (`body:has(> #main)` is a
    // `min-height: 100svh` flex column; `#main` and `#main > div` each carry
    // `flex: 1 0 auto`). Forcing 100vh on top of that stacked a full viewport
    // under the 37px announcement bar, so every visitor got a 37px scrollbar on
    // a page that fits. The flex chain measures whatever chrome actually
    // precedes the page — the bar's height is a merchant-styled variable, not a
    // constant worth encoding here — and still stretches the background to the
    // bottom edge.
    <div className="bg-gray-50" dir={dir}>
      <div className="mx-auto max-w-md px-4 py-8 sm:py-12">
        <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">
            {T("Track your order", "تتبّع طلبك")}
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            {T(
              "Enter your order number and the phone or email you used at checkout.",
              "اكتب رقم الطلب والموبايل أو الإيميل اللي استخدمته وقت الشراء.",
            )}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-5" noValidate>
            <div>
              <label
                htmlFor="track-order-number"
                className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500"
              >
                {T("Order number", "رقم الطلب")}
              </label>
              <input
                id="track-order-number"
                name="order_number"
                type="text"
                dir="ltr"
                autoComplete="off"
                placeholder="#1042"
                value={orderNumber}
                onChange={(e) => {
                  setOrderNumber(e.target.value);
                  setError(null);
                }}
                disabled={busy}
                aria-describedby={describedBy}
                className="block min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 font-mono text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/15 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <p className="mt-1 text-xs text-gray-400">
                {T(
                  "It's on your confirmation email or WhatsApp message.",
                  "هتلاقيه في إيميل التأكيد أو رسالة واتساب.",
                )}
              </p>
            </div>

            <fieldset>
              <legend className="mb-1.5 text-xs font-medium uppercase tracking-wide text-gray-500">
                {T("Confirm with", "التأكيد بـ")}
              </legend>
              <div className="flex gap-2">
                {(
                  [
                    ["phone", T("Phone", "الموبايل")],
                    ["email", T("Email", "الإيميل")],
                  ] as const
                ).map(([key, label]) => (
                  <label
                    key={key}
                    className={`flex min-h-11 flex-1 cursor-pointer items-center gap-2 rounded-xl border px-3.5 text-sm font-medium ${
                      contactKey === key
                        ? "border-gray-900 bg-gray-50 text-gray-900"
                        : "border-gray-200 text-gray-600"
                    }`}
                  >
                    <input
                      type="radio"
                      name="track-contact-key"
                      value={key}
                      checked={contactKey === key}
                      onChange={() => {
                        setContactKey(key);
                        setError(null);
                      }}
                      disabled={busy}
                      className="h-4 w-4 accent-gray-900"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {contactKey === "phone" ? (
              <div>
                <label
                  htmlFor="track-phone"
                  className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500"
                >
                  {T("Phone number", "رقم الموبايل")}
                </label>
                <input
                  id="track-phone"
                  name="phone"
                  type="tel"
                  dir="ltr"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="01xxxxxxxxx"
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setError(null);
                  }}
                  disabled={busy}
                  aria-describedby={describedBy}
                  className="block min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/15 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            ) : (
              <div>
                <label
                  htmlFor="track-email"
                  className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-gray-500"
                >
                  {T("Email", "البريد الإلكتروني")}
                </label>
                <input
                  id="track-email"
                  name="email"
                  type="email"
                  dir="ltr"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(null);
                  }}
                  disabled={busy}
                  aria-describedby={describedBy}
                  className="block min-h-11 w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:border-gray-900 focus:ring-2 focus:ring-gray-900/15 disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            )}

            {error && (
              <p
                id={errorId}
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-gray-900 px-6 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy
                ? T("Searching…", "جارٍ البحث…")
                : T("Track order", "تتبّع الطلب")}
            </button>
          </form>
        </section>

        <div className="mt-6 text-center">
          <a
            href={`/${domain}`}
            className="text-sm font-semibold text-gray-900 underline underline-offset-4"
          >
            {T("Continue shopping", "متابعة التسوق")}
          </a>
        </div>
      </div>
    </div>
  );
}
