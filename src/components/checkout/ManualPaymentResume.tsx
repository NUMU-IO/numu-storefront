"use client";

/**
 * The "finish paying" page for the manual rails (InstaPay, Vodafone Cash).
 *
 * A buyer who chose one of these transfers the money out-of-band and then
 * has to come back and prove it. They reach this page from the reference
 * link in their confirmation email — usually on a phone, usually as a
 * guest, often minutes or hours after checkout.
 *
 * Which means the page has to answer, in order:
 *
 *   1. Have I already paid?          → paid / in-review / rejected states
 *   2. Where do I send the money?     → the shared instructions card
 *   3. How do I prove I sent it?      → the upload form
 *
 * Authorization is the intent's reference code, passed as `?ref=`. When
 * the link has lost it (older emails, a copy-paste that dropped the query
 * string) the page asks for it rather than dead-ending — the buyer has
 * the code in their email and in their own transfer note.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { formatCents } from "@/lib/money";
import {
  CheckoutCard,
  ErrorBanner,
  Field,
  PrimaryButton,
  TextInput,
} from "@/components/checkout/ui";
import {
  ManualTransferInstructions,
  type ManualTransferPayload,
} from "@/components/checkout/ManualTransferInstructions";

type Method = "instapay" | "vodafone_cash";

interface CustomerRequirements {
  note_must_contain_reference: boolean;
  screenshot_must_show_amount: boolean;
  screenshot_must_show_recipient_ipa: boolean;
  screenshot_must_show_recipient_name: boolean;
  screenshot_must_show_transaction_ref: boolean;
}

interface LatestProof {
  id: string;
  status:
    | "awaiting_review"
    | "auto_approved"
    | "approved"
    | "rejected"
    | "expired";
  transaction_ref: string;
  rejection_reason: string | null;
  can_retry: boolean;
  created_at: string;
}

interface StatusView {
  order_id: string;
  order_number: string;
  reference_code: string;
  method: Method;
  destination: string;
  destination_kind: "ipa" | "wallet_number";
  supports_qr: boolean;
  ipa: string | null;
  ipa_display_name: string | null;
  fallback_phone: string | null;
  amount_cents: number;
  currency: string;
  expires_at: string;
  expires_in_seconds: number;
  intent_status: string;
  payment_status: string;
  latest_proof: LatestProof | null;
  customer_requirements: CustomerRequirements;
  qr_payload: string | null;
  qr_image_url: string | null;
  qr_link_url: string | null;
  is_deposit: boolean;
  order_total_cents: number | null;
  balance_due_cents: number | null;
}

const T = {
  loading: { en: "Loading…", ar: "جارٍ التحميل…" },
  notFound: {
    en: "We couldn't find this payment. Check the link in your email.",
    ar: "تعذّر العثور على هذه الدفعة. راجع الرابط في بريدك الإلكتروني.",
  },
  // Deliberately NOT "we couldn't find it". If the buyer has already
  // transferred, telling them the payment doesn't exist is alarming and,
  // when the cause is a 502, untrue.
  unreachable: {
    en: "We couldn't load your payment just now. Your transfer is safe — try again in a moment.",
    ar: "تعذّر تحميل بيانات الدفع الآن. تحويلك في أمان — حاول مرة أخرى بعد قليل.",
  },
  retry: { en: "Try again", ar: "حاول مرة أخرى" },
  needRef: {
    en: "Enter your payment reference",
    ar: "أدخل الرقم المرجعي للدفع",
  },
  needRefHint: {
    en: "It's in your order email, and it's the code you added to your transfer note.",
    ar: "ستجده في بريد الطلب، وهو نفس الكود الذي أضفته في ملاحظة التحويل.",
  },
  refLabel: { en: "Reference code", ar: "الرقم المرجعي" },
  continue: { en: "Continue", ar: "متابعة" },
  badRef: {
    en: "That reference doesn't match this order.",
    ar: "هذا الرقم المرجعي لا يطابق هذا الطلب.",
  },
  paidTitle: { en: "Payment confirmed", ar: "تم تأكيد الدفع" },
  paidBody: {
    en: "Your payment came through and your order is being prepared. Nothing else to do.",
    ar: "تم استلام دفعتك ويجري تجهيز طلبك. لا حاجة لأي إجراء آخر.",
  },
  reviewTitle: { en: "We got your receipt", ar: "استلمنا إيصالك" },
  reviewBody: {
    en: "The store is checking it now. You'll get an email as soon as it's confirmed — you can close this page.",
    ar: "المتجر يراجعه الآن. ستصلك رسالة بمجرد التأكيد — يمكنك إغلاق الصفحة.",
  },
  rejectedTitle: { en: "That receipt wasn't accepted", ar: "لم يتم قبول الإيصال" },
  reasonLabel: { en: "Reason", ar: "السبب" },
  retryBody: {
    en: "Upload a clearer screenshot of the same transfer below.",
    ar: "ارفع صورة أوضح لنفس التحويل بالأسفل.",
  },
  noRetryBody: {
    en: "Please contact the store directly to sort this out.",
    ar: "يُرجى التواصل مع المتجر مباشرة لحل الأمر.",
  },
  expiredTitle: { en: "This payment window closed", ar: "انتهت مهلة الدفع" },
  expiredBody: {
    en: "The reference for this order has expired. If you already sent the money, contact the store — otherwise place a new order.",
    ar: "انتهت صلاحية الرقم المرجعي لهذا الطلب. إذا كنت قد حوّلت المبلغ بالفعل، تواصل مع المتجر — وإلا أنشئ طلبًا جديدًا.",
  },
  uploadTitle: { en: "Upload your receipt", ar: "ارفع إيصال التحويل" },
  uploadIntro: {
    en: "Once you've transferred, send us the confirmation so we can release your order.",
    ar: "بعد التحويل، أرسل لنا التأكيد حتى نتمكن من تجهيز طلبك.",
  },
  checklistTitle: {
    en: "Your screenshot needs to show:",
    ar: "يجب أن تُظهر الصورة:",
  },
  reqNote: {
    en: "the reference code in the transfer note",
    ar: "الرقم المرجعي في ملاحظة التحويل",
  },
  reqAmount: { en: "the amount you sent", ar: "المبلغ الذي حوّلته" },
  reqRecipientIpa: {
    en: "the address you sent to",
    ar: "العنوان الذي حوّلت إليه",
  },
  reqRecipientWallet: {
    en: "the number you sent to",
    ar: "الرقم الذي حوّلت إليه",
  },
  reqRecipientName: { en: "the recipient's name", ar: "اسم المستلم" },
  reqTxnRef: {
    en: "the transaction number",
    ar: "رقم العملية",
  },
  fileLabel: { en: "Screenshot of your transfer", ar: "صورة التحويل" },
  fileHint: {
    en: "PNG, JPG or WebP · up to 5 MB",
    ar: "PNG أو JPG أو WebP · حتى ٥ ميجابايت",
  },
  choose: { en: "Choose image", ar: "اختر صورة" },
  replace: { en: "Choose a different image", ar: "اختر صورة أخرى" },
  txnLabel: { en: "Transaction number", ar: "رقم العملية" },
  txnHint: {
    en: "The reference your bank or wallet app showed after the transfer.",
    ar: "الرقم المرجعي الذي أظهره تطبيق البنك أو المحفظة بعد التحويل.",
  },
  amountLabel: { en: "Amount you sent", ar: "المبلغ الذي حوّلته" },
  submit: { en: "Send receipt", ar: "إرسال الإيصال" },
  submitting: { en: "Sending…", ar: "جارٍ الإرسال…" },
  needFile: {
    en: "Please attach a screenshot of your transfer.",
    ar: "يُرجى إرفاق صورة للتحويل.",
  },
  needTxn: {
    en: "Please enter the transaction number from your bank or wallet app.",
    ar: "يُرجى إدخال رقم العملية من تطبيق البنك أو المحفظة.",
  },
  tooBig: {
    en: "That image is larger than 5 MB. Please pick a smaller one.",
    ar: "حجم الصورة أكبر من ٥ ميجابايت. اختر صورة أصغر.",
  },
  genericError: {
    en: "Something went wrong. Please try again.",
    ar: "حدث خطأ ما. حاول مرة أخرى.",
  },
  help: { en: "Need help? Call / WhatsApp", ar: "للمساعدة اتصل/واتساب" },
} as const;

/** Poll while a proof sits in review, so approval flips the page by itself. */
const POLL_INTERVAL_MS = 15_000;
/** Stop polling after 15 minutes — a merchant review can take far longer,
 *  and by then the customer has the email. Prevents an abandoned tab from
 *  hitting the API all day. */
const POLL_MAX_MS = 15 * 60_000;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

type LoadOutcome = "ok" | "forbidden" | "missing" | "unreachable";

/**
 * Silent retries before the buyer is shown anything is wrong.
 *
 * The common cause of a transient failure here is a cold start or a deploy
 * rolling — both resolve in a couple of seconds, well inside the time it
 * takes someone to read the page.
 */
const LOAD_RETRIES = 2;
const LOAD_RETRY_DELAY_MS = 1200;

/**
 * A random idempotency key that works outside a secure context.
 *
 * `crypto.randomUUID` only exists on HTTPS and localhost. Production is
 * HTTPS so it is normally there, but an unguarded call throws a
 * TypeError on any plain-http origin — a LAN IP during testing, a
 * misconfigured custom domain — and it would throw from inside the
 * file-picker handler, leaving the buyer unable to attach anything at
 * all. The value only has to be unique per upload attempt, so a random
 * fallback is entirely adequate.
 */
function newIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Page wrapper for one of the states below.
 *
 * `globals.css` makes `#main > div > *` a flex column and gives its
 * last child `margin-top: auto` — a sticky-footer rule for theme roots
 * that render no `<main>`. This page's container sits in that same
 * slot, so without `[&>*:last-child]:mt-0` a short state (one card)
 * gets floated to the bottom of an empty viewport. The `!` is required:
 * that rule is ID-scoped, so a plain utility loses on specificity.
 * `gap` rather than
 * `space-y-*` because the auto-margin reset would otherwise eat the
 * spacing between stacked cards.
 */
function Screen({
  isAr,
  gap = "gap-4",
  children,
}: {
  isAr: boolean;
  gap?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      dir={isAr ? "rtl" : "ltr"}
      className={`flex flex-col ${gap} [&>*:last-child]:mt-0!`}
    >
      {children}
    </div>
  );
}

export function ManualPaymentResume({
  orderId,
  initialReference,
}: {
  orderId: string;
  initialReference: string | null;
}) {
  const [locale, setLocale] = useState<"en" | "ar">("en");
  const isAr = locale === "ar";
  const t = useCallback(
    (k: keyof typeof T) => T[k][isAr ? "ar" : "en"],
    [isAr],
  );

  const [reference, setReference] = useState(initialReference || "");
  const [refInput, setRefInput] = useState("");
  const [view, setView] = useState<StatusView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(initialReference));
  // Only set for the transient kind — there is nothing to retry about a
  // payment that genuinely isn't there.
  const [canRetry, setCanRetry] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [txnRef, setTxnRef] = useState("");
  const [amountMajor, setAmountMajor] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // One key per attempt-set: reused when the SAME upload is retried after a
  // network blip (so a flaky connection can't create two proofs), regenerated
  // whenever the buyer picks a different image (a genuine re-submission, which
  // must not collide with the previous proof's idempotency record).
  const idempotencyKeyRef = useRef<string>("");

  useEffect(() => {
    if (typeof document !== "undefined") {
      setLocale(document.documentElement.lang === "ar" ? "ar" : "en");
    }
  }, []);

  const load = useCallback(
    async (ref: string): Promise<LoadOutcome> => {
      try {
        const res = await fetch(
          `/api/payment-proof/${encodeURIComponent(orderId)}?ref=${encodeURIComponent(ref)}`,
          { cache: "no-store" },
        );
        if (res.status === 403) return "forbidden";
        // 404 is the only status that means "this payment is not a thing".
        // A 5xx, a proxy timeout or a dropped connection mean the opposite:
        // it exists, we just couldn't read it.
        if (res.status === 404) return "missing";
        if (!res.ok) return "unreachable";
        const body = await res.json();
        setView((body?.data || body) as StatusView);
        return "ok";
      } catch {
        return "unreachable";
      }
    },
    [orderId],
  );

  // Initial load when the link carried a reference.
  useEffect(() => {
    if (!reference) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      let outcome = await load(reference);
      // Only the transient kind is worth retrying: a 403 or a 404 will say
      // the same thing however many times we ask.
      for (let i = 0; i < LOAD_RETRIES && outcome === "unreachable"; i++) {
        await new Promise((r) => setTimeout(r, LOAD_RETRY_DELAY_MS));
        if (cancelled) return;
        outcome = await load(reference);
      }
      if (cancelled) return;
      setLoading(false);
      if (outcome === "forbidden") {
        // Wrong/stale code — fall back to asking for it rather than
        // showing a 403 the buyer can't act on.
        setReference("");
        setLoadError(T.badRef[isAr ? "ar" : "en"]);
      } else if (outcome === "missing") {
        setLoadError(T.notFound[isAr ? "ar" : "en"]);
      } else if (outcome === "unreachable") {
        setLoadError(T.unreachable[isAr ? "ar" : "en"]);
        setCanRetry(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reference, orderId, retryNonce]);

  // Poll only while a proof is genuinely pending a human.
  const pendingReview = view?.latest_proof?.status === "awaiting_review";
  useEffect(() => {
    if (!pendingReview || !reference) return;
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      if (Date.now() - startedAt > POLL_MAX_MS) {
        window.clearInterval(id);
        return;
      }
      void load(reference);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [pendingReview, reference, load]);

  // Revoke the object URL when the chosen image changes or on unmount —
  // otherwise every re-pick leaks a blob for the life of the tab.
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0] || null;
    e.target.value = ""; // let the same file be re-picked after an error
    if (!picked) return;
    if (picked.size > MAX_UPLOAD_BYTES) {
      setFormError(t("tooBig"));
      return;
    }
    setFormError(null);
    setFile(picked);
    idempotencyKeyRef.current = newIdempotencyKey();
  }

  async function submitProof() {
    if (!view) return;
    if (!file) {
      setFormError(t("needFile"));
      return;
    }
    if (txnRef.trim().length < 3) {
      setFormError(t("needTxn"));
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("file", file, file.name || "proof.jpg");
      form.append("reference", reference);
      form.append("transaction_ref", txnRef.trim());
      form.append("idempotency_key", idempotencyKeyRef.current);
      const major = Number(amountMajor);
      if (amountMajor.trim() !== "" && Number.isFinite(major) && major > 0) {
        form.append("declared_amount_cents", String(Math.round(major * 100)));
      }

      const res = await fetch(
        `/api/payment-proof/${encodeURIComponent(orderId)}`,
        { method: "POST", body: form },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = body?.detail || body?.error;
        setFormError(typeof detail === "string" ? detail : t("genericError"));
        setSubmitting(false);
        return;
      }
      // Re-read rather than trusting the POST's echo: the status view is
      // the single source of truth for which state the page renders, and
      // an auto-approved proof also flips payment_status.
      await load(reference);
      setFile(null);
      setTxnRef("");
      setSubmitting(false);
    } catch {
      setFormError(t("genericError"));
      setSubmitting(false);
    }
  }

  // ── Reference gate ────────────────────────────────────────────────
  if (!reference) {
    return (
      <Screen isAr={isAr}>
        {loadError && <ErrorBanner>{loadError}</ErrorBanner>}
        <CheckoutCard title={t("needRef")} description={t("needRefHint")}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = refInput.trim().toUpperCase();
              if (v) {
                setLoadError(null);
                setReference(v);
              }
            }}
            className="space-y-3"
          >
            <Field label={t("refLabel")}>
              <TextInput
                value={refInput}
                onChange={(e) => setRefInput(e.target.value)}
                placeholder="NU-XXXXXX"
                autoComplete="off"
                dir="ltr"
                inputMode="text"
              />
            </Field>
            <PrimaryButton type="submit" className="w-full">
              {t("continue")}
            </PrimaryButton>
          </form>
        </CheckoutCard>
      </Screen>
    );
  }

  if (loading && !view) {
    return (
      <Screen isAr={isAr}>
        <p className="text-center text-sm text-[var(--ck-muted)]">
          {t("loading")}
        </p>
      </Screen>
    );
  }
  if (loadError && !view) {
    return (
      <Screen isAr={isAr}>
        <ErrorBanner>{loadError}</ErrorBanner>
        {canRetry && (
          <PrimaryButton
            type="button"
            className="w-full"
            onClick={() => {
              setLoadError(null);
              setCanRetry(false);
              setLoading(true);
              setRetryNonce((n) => n + 1);
            }}
          >
            {t("retry")}
          </PrimaryButton>
        )}
      </Screen>
    );
  }
  if (!view) return null;

  // Order matters, and the ordering below is the whole state machine:
  //
  //   paid > in-review > expired > rejected > still-owing
  //
  // "in-review" outranks "expired" deliberately. The intent's expiry is
  // the deadline for *paying*, not for the merchant to review; the
  // backend gives them a 48h grace window past it before the sweeper
  // escalates. A buyer who uploaded in time must not be told their
  // payment window closed while their receipt is sitting in the queue.
  const proof = view.latest_proof;
  const isPaid =
    view.payment_status === "paid" ||
    view.intent_status === "paid" ||
    proof?.status === "approved" ||
    proof?.status === "auto_approved";
  const isExpired =
    !isPaid &&
    !pendingReview &&
    (view.intent_status === "expired" ||
      view.intent_status === "cancelled" ||
      view.expires_in_seconds <= 0);
  const isRejected = !isPaid && !isExpired && proof?.status === "rejected";
  // Past expiry the upload endpoint 410s, so don't offer a form that
  // can only fail — the expired card is shown instead.
  const canUpload = !isPaid && !isExpired && (!proof || Boolean(proof.can_retry));

  // ── Terminal states ───────────────────────────────────────────────
  if (isPaid) {
    return (
      <Screen isAr={isAr}>
        <CheckoutCard title={t("paidTitle")}>
          <p className="text-sm text-[var(--ck-fg)]">{t("paidBody")}</p>
          <p className="mt-3 text-sm text-[var(--ck-muted)]">
            {isAr ? "طلب رقم" : "Order"} #{view.order_number} ·{" "}
            {formatCents(view.amount_cents, view.currency)}
          </p>
        </CheckoutCard>
      </Screen>
    );
  }

  if (pendingReview) {
    return (
      <Screen isAr={isAr}>
        <CheckoutCard title={t("reviewTitle")}>
          <p className="text-sm text-[var(--ck-fg)]">{t("reviewBody")}</p>
          <p className="mt-3 text-sm text-[var(--ck-muted)]">
            {isAr ? "طلب رقم" : "Order"} #{view.order_number} ·{" "}
            {formatCents(view.amount_cents, view.currency)}
          </p>
        </CheckoutCard>
      </Screen>
    );
  }

  if (isExpired) {
    return (
      <Screen isAr={isAr}>
        <CheckoutCard title={t("expiredTitle")}>
          <p className="text-sm text-[var(--ck-fg)]">{t("expiredBody")}</p>
          {view.fallback_phone && (
            <p className="mt-3 text-sm text-[var(--ck-muted)]" dir="ltr">
              {t("help")}: {view.fallback_phone}
            </p>
          )}
        </CheckoutCard>
      </Screen>
    );
  }

  // ── Still owing: instructions + upload form ───────────────────────
  const payload: ManualTransferPayload = {
    provider: view.method,
    reference_code: view.reference_code,
    destination: view.destination,
    destination_kind: view.destination_kind,
    supports_qr: view.supports_qr,
    ipa: view.ipa,
    display_name: view.ipa_display_name,
    ipa_display_name: view.ipa_display_name,
    fallback_phone: view.fallback_phone,
    qr_payload: view.qr_payload,
    qr_image_url: view.qr_image_url,
    qr_link_url: view.qr_link_url,
    amount_cents: view.amount_cents,
    currency: view.currency,
    expires_at: view.expires_at,
    expires_in_seconds: view.expires_in_seconds,
    is_deposit: view.is_deposit,
    order_total_cents: view.order_total_cents,
    balance_due_cents: view.balance_due_cents,
  };

  const req = view.customer_requirements;
  const checklist = [
    req?.note_must_contain_reference && t("reqNote"),
    req?.screenshot_must_show_amount && t("reqAmount"),
    req?.screenshot_must_show_recipient_ipa &&
      (view.destination_kind === "wallet_number"
        ? t("reqRecipientWallet")
        : t("reqRecipientIpa")),
    req?.screenshot_must_show_recipient_name && t("reqRecipientName"),
    req?.screenshot_must_show_transaction_ref && t("reqTxnRef"),
  ].filter(Boolean) as string[];

  return (
    <Screen isAr={isAr} gap="gap-5">
      {isRejected && (
        <CheckoutCard title={t("rejectedTitle")}>
          {proof?.rejection_reason && (
            <div className="rounded-[var(--ck-radius-sm)] bg-red-50 px-3 py-2 text-sm text-red-800">
              <span className="font-semibold">{t("reasonLabel")}: </span>
              {proof.rejection_reason}
            </div>
          )}
          <p className="mt-3 text-sm text-[var(--ck-fg)]">
            {proof?.can_retry ? t("retryBody") : t("noRetryBody")}
          </p>
        </CheckoutCard>
      )}

      <ManualTransferInstructions
        data={payload}
        orderNumber={view.order_number}
        locale={locale}
      />

      {canUpload && (
        <CheckoutCard title={t("uploadTitle")} description={t("uploadIntro")}>
          {checklist.length > 0 && (
            <div className="mb-4 rounded-[var(--ck-radius-sm)] bg-[var(--ck-accent-tint)] px-3 py-2.5">
              <p className="text-xs font-semibold text-[var(--ck-fg)]">
                {t("checklistTitle")}
              </p>
              <ul className="mt-1.5 space-y-1">
                {checklist.map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-1.5 text-xs text-[var(--ck-fg)]"
                  >
                    <span aria-hidden>•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-4">
            {/* Deliberately NOT wrapped in <Field>: that renders a
                <label>, and a <label> containing both the file input and
                a button that clicks it opens the picker twice. Plain
                markup with an explicit aria-label instead. */}
            <div className="block">
              <span className="mb-1.5 block text-xs text-[var(--ck-fg)] [font-weight:var(--ck-label-weight)] [letter-spacing:var(--ck-label-tracking)] [text-transform:var(--ck-label-transform)]">
                {t("fileLabel")}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={onPickFile}
                aria-label={t("fileLabel")}
              />
              {preview ? (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={preview}
                    alt=""
                    className="h-24 w-24 rounded-[var(--ck-radius-sm)] border border-[var(--ck-frame)] object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-sm font-medium text-[var(--ck-fg)] underline underline-offset-4"
                  >
                    {t("replace")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex min-h-24 w-full items-center justify-center rounded-[var(--ck-radius-sm)] border border-dashed border-[var(--ck-frame)] px-4 py-6 text-sm font-medium text-[var(--ck-muted)] transition-colors hover:border-[var(--ck-accent)] hover:text-[var(--ck-fg)]"
                >
                  {t("choose")}
                </button>
              )}
              <span className="mt-1 block text-xs text-[var(--ck-muted)]">
                {t("fileHint")}
              </span>
            </div>

            <Field label={t("txnLabel")} hint={t("txnHint")}>
              <TextInput
                value={txnRef}
                onChange={(e) => setTxnRef(e.target.value)}
                placeholder="123456789"
                autoComplete="off"
                dir="ltr"
                inputMode="text"
                maxLength={64}
              />
            </Field>

            <Field label={`${t("amountLabel")} (${view.currency})`}>
              <TextInput
                value={amountMajor}
                onChange={(e) => setAmountMajor(e.target.value)}
                placeholder={(view.amount_cents / 100).toFixed(2)}
                inputMode="decimal"
                dir="ltr"
              />
            </Field>

            {formError && <ErrorBanner>{formError}</ErrorBanner>}

            <PrimaryButton
              type="button"
              onClick={submitProof}
              disabled={submitting}
              className="w-full"
            >
              {submitting ? t("submitting") : t("submit")}
            </PrimaryButton>
          </div>
        </CheckoutCard>
      )}
    </Screen>
  );
}
