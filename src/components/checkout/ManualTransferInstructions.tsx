"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

/**
 * Payload the backend returns as `payment_data` from POST /checkout for
 * any manual ("push payment") rail. Both rails share the shape; the
 * fields that differ are nulled rather than omitted so this component
 * can branch on them without optional-chaining guesswork.
 */
export interface ManualTransferPayload {
  provider: "instapay" | "vodafone_cash";
  type?: string;
  reference_code: string;
  /** Rail-neutral: the string the customer sends money to. */
  destination?: string;
  destination_kind?: "ipa" | "wallet_number";
  /** False on Vodafone Cash — there is nothing to scan. */
  supports_qr?: boolean;
  /** InstaPay only; null on Vodafone Cash. */
  ipa?: string | null;
  /** Vodafone Cash only; null on InstaPay. */
  wallet_number?: string | null;
  display_name?: string | null;
  /** Legacy alias of display_name. */
  ipa_display_name?: string | null;
  fallback_phone?: string | null;
  qr_payload?: string | null;
  qr_image_url?: string | null;
  qr_link_url?: string | null;
  amount?: string;
  amount_cents?: number;
  currency?: string;
  expires_at?: string;
  expires_in_seconds?: number;
  is_deposit?: boolean;
  order_total_cents?: number | null;
  balance_due_cents?: number | null;
}

/** @deprecated Use {@link ManualTransferPayload}. */
export type InstaPayPayload = ManualTransferPayload;

interface Props {
  data: ManualTransferPayload;
  /** Omitted on surfaces that don't know it — the line is then hidden. */
  orderNumber?: string;
  /**
   * Renders the "I've paid — continue" button when supplied. The resume
   * page omits it: there the next step is the upload form directly below,
   * so a button that only navigates would be a dead end.
   */
  onContinue?: () => void;
  locale?: string;
}

function fmtMoney(cents: number | undefined, currency = "EGP", locale = "en") {
  if (typeof cents !== "number") return "";
  try {
    return new Intl.NumberFormat(locale === "ar" ? "ar-EG" : "en", {
      style: "currency",
      currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard blocked — user can select manually */
        }
      }}
      className="shrink-0 rounded-[var(--ck-radius-sm)] border-[length:var(--ck-frame-width)] border-[var(--ck-frame)] px-2 py-1 text-xs font-medium text-[var(--ck-fg)] transition-colors hover:border-[var(--ck-accent)]"
      aria-label={label}
    >
      {copied ? "✓" : "Copy"}
    </button>
  );
}

/**
 * Where a buyer goes to upload their receipt.
 *
 * Hyphenated segments, matching the storefront routes and the `?ref=`
 * links the backend puts in confirmation emails. The reference code is
 * what authorizes the page — without it a guest gets the "type your
 * reference" gate instead of their order.
 */
export function manualResumePath(
  domain: string,
  provider: ManualTransferPayload["provider"],
  orderId: string,
  referenceCode: string,
): string {
  const segment = provider === "vodafone_cash" ? "vodafone-cash" : "instapay";
  return `/${domain}/${segment}/${orderId}?ref=${encodeURIComponent(referenceCode)}`;
}

/** Per-rail copy + presentation. Everything that differs lives here. */
function railCopy(provider: ManualTransferPayload["provider"], isAr: boolean) {
  if (provider === "vodafone_cash") {
    return {
      brand: "Vodafone Cash",
      brandAr: "فودافون كاش",
      // The official lockup. Wide (2.6:1), so it needs more height than
      // InstaPay's mark before the "vodafone" wordmark stops being legible.
      logo: "/vodafone-cash-logo.png",
      logoClass: "h-10",
      title: isAr ? "أكمل الدفع عبر فودافون كاش" : "Complete your Vodafone Cash payment",
      toDestination: isAr
        ? "إلى رقم محفظة فودافون كاش"
        : "to this Vodafone Cash wallet number",
      copyLabel: "Copy wallet number",
      // Vodafone Cash has no scannable code — a transfer starts by
      // dialling *9# or from inside the Ana Vodafone app. Telling the
      // customer how to start is worth more than a QR they can't use.
      howTo: isAr
        ? "اطلب ‎*9#‎ أو افتح تطبيق «أنا فودافون» ← تحويل الأموال"
        : "Dial *9# or open the Ana Vodafone app → Transfer money",
      // A wallet number is a phone number: on mobile, offering it as a
      // tel: link saves the customer retyping 11 digits.
      dialHref: "tel:*9%23",
      dialLabel: isAr ? "اطلب ‎*9#‎" : "Dial *9#",
    };
  }
  return {
    brand: "InstaPay",
    brandAr: "إنستاباي",
    logo: "/instapay-logo.svg",
    logoClass: "h-8",
    title: isAr ? "أكمل الدفع عبر إنستاباي" : "Complete your InstaPay payment",
    toDestination: isAr
      ? "إلى عنوان إنستاباي (IPA)"
      : "to this InstaPay address (IPA)",
    copyLabel: "Copy IPA",
    howTo: null as string | null,
    dialHref: null as string | null,
    dialLabel: null as string | null,
  };
}

/**
 * Manual-verification instructions for InstaPay and Vodafone Cash.
 *
 * Neither rail has a hosted payment page: the buyer sends the exact
 * amount to the merchant's destination (including the reference in the
 * transfer note), then the merchant — or the OCR rules — confirm it.
 *
 * The one presentational rule worth stating: **no QR on Vodafone
 * Cash**. The backend already nulls every QR field for that rail, and
 * this component additionally gates on `supports_qr`, because a QR box
 * the customer cannot scan is worse than no box at all.
 */
export function ManualTransferInstructions({
  data,
  orderNumber,
  onContinue,
  locale = "en",
}: Props) {
  const isAr = locale === "ar";
  const provider = data.provider ?? "instapay";
  const rail = railCopy(provider, isAr);
  const currency = data.currency || "EGP";
  const amount =
    fmtMoney(data.amount_cents, currency, locale) ||
    (data.amount ? `${data.amount} ${currency}` : "");

  // Destination, tolerating older payloads that only carried `ipa`.
  const destination = data.destination || data.ipa || data.wallet_number || "";
  const displayName = data.display_name ?? data.ipa_display_name ?? null;

  // Live countdown to expiry.
  const [remaining, setRemaining] = useState<number | null>(
    typeof data.expires_in_seconds === "number" ? data.expires_in_seconds : null,
  );
  useEffect(() => {
    if (remaining === null) return;
    if (remaining <= 0) return;
    const id = window.setInterval(
      () => setRemaining((r) => (r === null ? r : Math.max(0, r - 1))),
      1000,
    );
    return () => window.clearInterval(id);
  }, [remaining]);
  const mmss =
    remaining === null
      ? null
      : `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(
          remaining % 60,
        ).padStart(2, "0")}`;

  // QR only exists on InstaPay. When the merchant hasn't uploaded a
  // static image, render one from the share link (preferred — a phone
  // camera opens the universal link) or the raw instapay:// payload.
  const qrEnabled = data.supports_qr !== false && provider === "instapay";
  const qrSource = !qrEnabled
    ? ""
    : data.qr_image_url
      ? ""
      : data.qr_link_url || data.qr_payload || "";
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!qrSource) {
      setQrDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(qrSource, { width: 240, margin: 1, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [qrSource]);
  const qrSrc = qrEnabled ? data.qr_image_url || qrDataUrl : null;
  const showQrBlock = qrEnabled && (qrSrc || data.qr_link_url);

  const t = {
    order: isAr ? "طلب رقم" : "Order",
    sendExactly: isAr ? "حوّل هذا المبلغ بالضبط" : "Send exactly",
    reference: isAr
      ? "رقم مرجعي — أضِفه في ملاحظة التحويل"
      : "Reference — add it to the transfer note",
    scan: isAr ? "أو امسح رمز QR من تطبيق إنستاباي" : "Or scan with your InstaPay / bank app",
    openLink: isAr ? "افتح في إنستاباي" : "Open in InstaPay",
    expiresIn: isAr ? "تنتهي الصلاحية خلال" : "Expires in",
    expired: isAr
      ? "انتهت صلاحية هذا المرجع — أنشئ طلبًا جديدًا."
      : "This reference has expired — place a new order.",
    after: isAr
      ? "بعد التحويل سنؤكد الدفع ونجهّز طلبك. احتفظ بالرقم المرجعي."
      : "After you transfer, we'll confirm payment and process your order. Keep the reference.",
    fallback: isAr ? "للمساعدة اتصل/واتساب" : "Need help? Call / WhatsApp",
    done: isAr ? "لقد حوّلت — أرفق الإيصال" : "I've paid — upload receipt",
    depositNote: isAr ? "هذا عربون؛ الباقي عند الاستلام" : "This is a deposit; balance due on delivery",
  };

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-4 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={rail.logo}
          alt={rail.brand}
          className={`mx-auto mb-3 w-auto ${rail.logoClass}`}
        />
        <h2 className="text-lg font-bold text-[var(--ck-fg)]">{rail.title}</h2>
        {orderNumber ? (
          <p className="mt-1 text-sm text-[var(--ck-muted)]">
            {t.order} #{orderNumber}
          </p>
        ) : null}
      </div>

      <div className="space-y-4 rounded-[var(--ck-radius)] border-[length:var(--ck-frame-width)] border-[var(--ck-frame)] bg-[var(--ck-surface)] p-5 [box-shadow:var(--ck-shadow)]">
        {/* Amount */}
        <div className="text-center">
          <p className="text-xs uppercase tracking-wide text-[var(--ck-muted)]">{t.sendExactly}</p>
          <p className="text-2xl font-bold text-[var(--ck-fg)]">{amount}</p>
          {data.is_deposit && typeof data.balance_due_cents === "number" && (
            <p className="mt-1 text-xs text-[var(--ck-muted)]">
              {t.depositNote} ({fmtMoney(data.balance_due_cents, currency, locale)})
            </p>
          )}
        </div>

        {/* Destination — IPA or wallet number */}
        {destination && (
          <div>
            <p className="mb-1 text-xs font-medium text-[var(--ck-muted)]">
              {rail.toDestination}
            </p>
            <div className="flex items-center gap-2 rounded-[var(--ck-radius-sm)] border-[length:var(--ck-frame-width)] border-[var(--ck-frame)] bg-[var(--ck-surface-2,#f9fafb)] px-3 py-2">
              <span className="flex-1 truncate font-mono text-sm text-[var(--ck-fg)]" dir="ltr">
                {destination}
                {displayName ? ` · ${displayName}` : ""}
              </span>
              <CopyButton value={destination} label={rail.copyLabel} />
            </div>
          </div>
        )}

        {/* Reference */}
        <div>
          <p className="mb-1 text-xs font-medium text-[var(--ck-muted)]">{t.reference}</p>
          <div className="flex items-center gap-2 rounded-[var(--ck-radius-sm)] border-[length:var(--ck-frame-width)] border-[var(--ck-frame)] bg-[var(--ck-surface-2,#f9fafb)] px-3 py-2">
            <span className="flex-1 truncate font-mono text-sm font-semibold text-[var(--ck-fg)]" dir="ltr">
              {data.reference_code}
            </span>
            <CopyButton value={data.reference_code} label="Copy reference" />
          </div>
        </div>

        {/* How to start the transfer — the QR's replacement on rails
            that don't have one. */}
        {rail.howTo && (
          <div className="rounded-[var(--ck-radius-sm)] bg-[var(--ck-accent-tint)] px-3 py-2.5">
            <p className="text-xs text-[var(--ck-fg)]">{rail.howTo}</p>
            {rail.dialHref && (
              <a
                href={rail.dialHref}
                className="mt-1.5 inline-block text-sm font-medium text-[var(--ck-fg)] underline underline-offset-2 sm:hidden"
              >
                {rail.dialLabel}
              </a>
            )}
          </div>
        )}

        {/* QR — InstaPay only */}
        {showQrBlock && (
          <div className="flex flex-col items-center gap-2 border-t border-[var(--ck-frame)] pt-4">
            <p className="text-xs text-[var(--ck-muted)]">{t.scan}</p>
            {qrSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrSrc}
                alt="InstaPay QR"
                className="h-44 w-44 rounded-[var(--ck-radius-sm)] border border-[var(--ck-frame)] bg-white object-contain p-1"
              />
            )}
            {data.qr_link_url && (
              <a
                href={data.qr_link_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-[var(--ck-fg)] underline underline-offset-2"
              >
                {t.openLink}
              </a>
            )}
          </div>
        )}

        {/* Expiry */}
        {mmss !== null && (
          <p className="text-center text-xs text-[var(--ck-muted)]">
            {remaining && remaining > 0 ? (
              <>
                {t.expiresIn} <span className="font-semibold text-[var(--ck-fg)]">{mmss}</span>
              </>
            ) : (
              <span className="text-red-600">{t.expired}</span>
            )}
          </p>
        )}

        <p className="text-center text-xs text-[var(--ck-muted)]">{t.after}</p>
        {data.fallback_phone && (
          <p className="text-center text-xs text-[var(--ck-muted)]" dir="ltr">
            {t.fallback}: {data.fallback_phone}
          </p>
        )}
      </div>

      {onContinue ? (
        <button
          type="button"
          onClick={onContinue}
          className="mt-5 min-h-11 w-full rounded-full bg-[var(--ck-button)] py-3.5 text-sm font-bold uppercase tracking-wide text-[var(--ck-button-text)] transition-[filter] hover:brightness-95"
        >
          {t.done}
        </button>
      ) : null}
    </div>
  );
}

/** @deprecated Use {@link ManualTransferInstructions}. */
export const InstaPayInstructions = ManualTransferInstructions;
