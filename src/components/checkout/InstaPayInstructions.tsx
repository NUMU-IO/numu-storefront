"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

export interface InstaPayPayload {
  provider: "instapay";
  type?: string;
  reference_code: string;
  ipa?: string;
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

interface Props {
  data: InstaPayPayload;
  orderNumber: string;
  onContinue: () => void;
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
      className="shrink-0 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
      aria-label={label}
    >
      {copied ? "✓" : "Copy"}
    </button>
  );
}

/**
 * InstaPay manual-verification instructions. InstaPay has no hosted page —
 * the buyer sends the exact amount to the merchant's IPA handle (including
 * the reference in the transfer note), then the merchant confirms. The
 * backend returns this payload as `payment_data` from POST /checkout.
 */
export function InstaPayInstructions({ data, orderNumber, onContinue, locale = "en" }: Props) {
  const isAr = locale === "ar";
  const currency = data.currency || "EGP";
  const amount =
    fmtMoney(data.amount_cents, currency, locale) ||
    (data.amount ? `${data.amount} ${currency}` : "");

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

  // When the merchant hasn't uploaded a static QR image, render one from the
  // InstaPay share link (preferred — a phone camera opens the universal link)
  // or the raw instapay:// payload. The qrcode package draws to a data URL.
  const qrSource = data.qr_image_url
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
  const qrSrc = data.qr_image_url || qrDataUrl;

  const t = {
    title: isAr ? "أكمل الدفع عبر إنستاباي" : "Complete your InstaPay payment",
    order: isAr ? "طلب رقم" : "Order",
    sendExactly: isAr ? "حوّل هذا المبلغ بالضبط" : "Send exactly",
    toIpa: isAr ? "إلى عنوان إنستاباي (IPA)" : "to this InstaPay address (IPA)",
    reference: isAr ? "رقم مرجعي — أضِفه في ملاحظة التحويل" : "Reference — add it to the transfer note",
    scan: isAr ? "أو امسح رمز QR من تطبيق إنستاباي" : "Or scan with your InstaPay / bank app",
    openLink: isAr ? "افتح في إنستاباي" : "Open in InstaPay",
    expiresIn: isAr ? "تنتهي الصلاحية خلال" : "Expires in",
    expired: isAr ? "انتهت صلاحية هذا المرجع — أنشئ طلبًا جديدًا." : "This reference has expired — place a new order.",
    after: isAr
      ? "بعد التحويل سنؤكد الدفع ونجهّز طلبك. احتفظ بالرقم المرجعي."
      : "After you transfer, we'll confirm payment and process your order. Keep the reference.",
    fallback: isAr ? "للمساعدة اتصل/واتساب" : "Need help? Call / WhatsApp",
    done: isAr ? "لقد حوّلت — متابعة" : "I've paid — continue",
    depositNote: isAr ? "هذا عربون؛ الباقي عند الاستلام" : "This is a deposit; balance due on delivery",
  };

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-4 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/instapay-logo.svg"
          alt="InstaPay"
          className="mx-auto mb-3 h-8 w-auto"
        />
        <h2 className="text-lg font-bold text-gray-900">{t.title}</h2>
        <p className="mt-1 text-sm text-gray-500">
          {t.order} #{orderNumber}
        </p>
      </div>

      <div className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        {/* Amount */}
        <div className="text-center">
          <p className="text-xs uppercase tracking-wide text-gray-500">{t.sendExactly}</p>
          <p className="text-2xl font-bold text-gray-900">{amount}</p>
          {data.is_deposit && typeof data.balance_due_cents === "number" && (
            <p className="mt-1 text-xs text-gray-500">
              {t.depositNote} ({fmtMoney(data.balance_due_cents, currency, locale)})
            </p>
          )}
        </div>

        {/* IPA */}
        {data.ipa && (
          <div>
            <p className="mb-1 text-xs font-medium text-gray-500">{t.toIpa}</p>
            <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <span className="flex-1 truncate font-mono text-sm text-gray-900" dir="ltr">
                {data.ipa}
                {data.ipa_display_name ? ` · ${data.ipa_display_name}` : ""}
              </span>
              <CopyButton value={data.ipa} label="Copy IPA" />
            </div>
          </div>
        )}

        {/* Reference */}
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500">{t.reference}</p>
          <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <span className="flex-1 truncate font-mono text-sm font-semibold text-gray-900" dir="ltr">
              {data.reference_code}
            </span>
            <CopyButton value={data.reference_code} label="Copy reference" />
          </div>
        </div>

        {/* QR */}
        {(qrSrc || data.qr_link_url) && (
          <div className="flex flex-col items-center gap-2 border-t border-gray-100 pt-4">
            <p className="text-xs text-gray-500">{t.scan}</p>
            {qrSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrSrc}
                alt="InstaPay QR"
                className="h-44 w-44 rounded-lg border border-gray-200 bg-white object-contain p-1"
              />
            )}
            {data.qr_link_url && (
              <a
                href={data.qr_link_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-gray-900 underline underline-offset-2"
              >
                {t.openLink}
              </a>
            )}
          </div>
        )}

        {/* Expiry */}
        {mmss !== null && (
          <p className="text-center text-xs text-gray-500">
            {remaining && remaining > 0 ? (
              <>
                {t.expiresIn} <span className="font-semibold text-gray-700">{mmss}</span>
              </>
            ) : (
              <span className="text-red-600">{t.expired}</span>
            )}
          </p>
        )}

        <p className="text-center text-xs text-gray-500">{t.after}</p>
        {data.fallback_phone && (
          <p className="text-center text-xs text-gray-400" dir="ltr">
            {t.fallback}: {data.fallback_phone}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={onContinue}
        className="mt-5 w-full rounded-xl bg-gray-900 py-3.5 text-sm font-bold text-white hover:bg-gray-800"
      >
        {t.done}
      </button>
    </div>
  );
}
