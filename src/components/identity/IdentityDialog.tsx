"use client";

/**
 * Phone-first identity dialog — phone step → WhatsApp OTP step.
 *
 * Two variants of the same flow:
 *   - "checkout": blocks the checkout form until the phone is verified
 *     (the SERVER enforces this too — /api/checkout 403s
 *     phone_verification_required — the dialog is UX, not the guard).
 *   - "save-cart": the dismissible mid-shopping nudge. Phone entry alone is
 *     already a win (the cart becomes recoverable); OTP is the bonus step.
 *
 * Cart↔phone attach happens ON PHONE SUBMIT, before the OTP round-trip —
 * `trackCartState({ phone })` upserts the abandoned-checkout row, so a
 * shopper who types a number and bails is still reachable. This is the
 * deliberate pre-OTP-attach product decision.
 *
 * Structure follows components/checkout/location/LocationDialog.tsx
 * (portal + body-scroll lock + Escape + `--ck-*` brand tokens) with the
 * focus-restore behaviour of promo/PopupModal.tsx.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  ErrorBanner,
  Field,
  PrimaryButton,
  TextInput,
} from "@/components/checkout/ui";
import { trackCartState } from "@/lib/abandoned-cart";
import { COUNTRIES, DIAL, composePhone, looksLikePhone } from "@/lib/phone";
import { identityLabels, type IdentityLocale } from "./labels";

export interface IdentityProfile {
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string;
}

export interface IdentityVerifiedResult {
  phone: string;
  customerKnown: boolean;
  profile: IdentityProfile | null;
}

interface IdentityDialogProps {
  open: boolean;
  variant: "checkout" | "save-cart";
  /** Dismiss request (backdrop / Escape / "not now"). The checkout variant
   * may choose to ignore it — that's the caller's call, not ours. */
  onOpenChange: (open: boolean) => void;
  onVerified: (result: IdentityVerifiedResult) => void;
  /** Pre-fill the phone input (e.g. checkout already has a number typed). */
  initialPhone?: string;
}

type Step = "phone" | "code" | "done";

// Matches the backend's OTP_CODE_LENGTH (otp_service.py).
const OTP_LENGTH = 4;

function readCsrf(): string {
  if (typeof document === "undefined") return "";
  return document.cookie.match(/(?:^|; )numu_csrf=([^;]+)/)?.[1] ?? "";
}

/** The numu_csrf cookie is minted by GET /api/cart — make sure it exists
 * before the first identity POST (a deep-linked /checkout may not have
 * touched the cart API from this document yet). */
async function ensureCsrf(): Promise<string> {
  let token = readCsrf();
  if (!token) {
    try {
      await fetch("/api/cart", { cache: "no-store", credentials: "include" });
    } catch {
      /* the POST below will surface the real failure */
    }
    token = readCsrf();
  }
  return token;
}

export function IdentityDialog({
  open,
  variant,
  onOpenChange,
  onVerified,
  initialPhone,
}: IdentityDialogProps) {
  const isAr =
    typeof document !== "undefined" &&
    document.documentElement.lang?.toLowerCase().startsWith("ar");
  const locale: IdentityLocale = isAr ? "ar" : "en";
  const t = identityLabels(locale);

  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<Step>("phone");
  const [cc, setCc] = useState("EG");
  const [localPhone, setLocalPhone] = useState(initialPhone ?? "");
  const [composed, setComposed] = useState("");
  const [otpId, setOtpId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendLeft, setResendLeft] = useState(0);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);

  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => setMounted(true), []);

  // Reset per open; remember the opener for focus restore.
  useEffect(() => {
    if (open) {
      restoreFocusRef.current = document.activeElement as HTMLElement | null;
      setStep("phone");
      setCode("");
      setOtpId(null);
      setError(null);
      setBusy(false);
      setDoneMessage(null);
      if (initialPhone) setLocalPhone(initialPhone);
    } else if (restoreFocusRef.current) {
      restoreFocusRef.current.focus?.();
      restoreFocusRef.current = null;
    }
  }, [open, initialPhone]);

  // Body scroll lock + Escape (same as LocationDialog).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onOpenChange]);

  // Resend countdown.
  useEffect(() => {
    if (resendLeft <= 0) return;
    const id = setInterval(
      () => setResendLeft((s) => (s > 0 ? s - 1 : 0)),
      1000,
    );
    return () => clearInterval(id);
  }, [resendLeft > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const issue = useCallback(
    async (phone: string) => {
      setBusy(true);
      setError(null);
      try {
        const csrf = await ensureCsrf();
        const res = await fetch("/api/identity/otp/issue", {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "x-numu-csrf": csrf,
          },
          body: JSON.stringify({ phone, language: locale }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok) {
          setOtpId(String(json?.data?.otp_id ?? ""));
          setResendLeft(Number(json?.data?.resend_after ?? 45));
          setStep("code");
          setCode("");
          return true;
        }
        const codeStr = json?.detail?.code ?? json?.error?.code ?? "";
        if (codeStr === "otp_cooldown") {
          const retry = Number(json?.detail?.retry_after ?? 45);
          setResendLeft(retry);
          // The previous code is still live — let them type it.
          if (otpId) {
            setStep("code");
            return true;
          }
          setError(t.cooldown(retry));
        } else if (codeStr === "otp_hourly_limit") {
          setError(t.hourlyLimit);
        } else if (codeStr === "invalid_phone") {
          setError(t.phoneInvalid);
        } else if (
          codeStr === "otp_send_failed" ||
          codeStr === "otp_unavailable"
        ) {
          setError(t.sendFailed);
        } else {
          setError(t.genericError);
        }
        return false;
      } catch {
        setError(t.genericError);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [locale, otpId, t],
  );

  const handlePhoneSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const phone = composePhone(cc, localPhone);
    if (!looksLikePhone(phone)) {
      setError(t.phoneInvalid);
      return;
    }
    setComposed(phone);
    // Pre-OTP cart↔phone attach: the abandoned-checkout row learns the
    // phone NOW, so bailing at the code step still leaves a recoverable
    // cart. Fire-and-forget — never blocks the OTP.
    void trackCartState({ phone });
    await issue(phone);
  };

  const verify = async () => {
    if (busy || !otpId) return;
    const trimmed = code.trim();
    if (trimmed.length < OTP_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/identity/otp/verify", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-numu-csrf": readCsrf(),
        },
        body: JSON.stringify({ otp_id: otpId, code: trimmed, phone: composed }),
      });
      const json = await res.json().catch(() => ({}));
      const data = json?.data ?? {};
      const verdict = String(data?.verdict ?? "");
      if (res.ok && verdict === "verified") {
        const profile: IdentityProfile | null = data?.profile ?? null;
        const customerKnown = Boolean(data?.customer_known);
        setDoneMessage(
          customerKnown && profile?.first_name
            ? t.welcomeBack(profile.first_name)
            : variant === "save-cart"
              ? t.cartSaved
              : t.verified,
        );
        setStep("done");
        // Let the ✅ paint before the dialog yields control.
        setTimeout(() => {
          onVerified({ phone: composed, customerKnown, profile });
        }, 650);
        return;
      }
      if (verdict === "wrong_code") {
        setError(t.wrongCode(Number(data?.attempts_left ?? 0)));
        setCode(""); // empty the boxes for the retry
      } else if (verdict === "locked") {
        setError(t.lockedCode);
      } else if (verdict === "expired") {
        setError(t.expiredCode);
      } else {
        setError(t.genericError);
      }
    } catch {
      setError(t.genericError);
    } finally {
      setBusy(false);
    }
  };

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
    await verify();
  };

  // Auto-submit the moment the fourth digit lands (per design — the boxes
  // ARE the submit). The button stays as the fallback for edge cases.
  useEffect(() => {
    if (step === "code" && code.length === OTP_LENGTH && !busy && otpId) {
      void verify();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, step]);

  if (!mounted || !open) return null;

  const title =
    variant === "checkout" ? t.titleCheckout : t.titleSaveCart;
  const subtitle =
    variant === "checkout" ? t.subtitleCheckout : t.subtitleSaveCart;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      dir={isAr ? "rtl" : "ltr"}
      className="fixed inset-0 z-[9998] flex items-end justify-center sm:items-center sm:p-4"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
      />

      {/* Panel — bottom sheet on mobile, centered card on desktop. Inherits
          the checkout's --ck-* brand tokens mirrored to :root. */}
      <div className="relative w-full max-w-full rounded-t-2xl bg-[var(--ck-surface,#fff)] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-[var(--ck-fg,#111827)] shadow-2xl [font-family:var(--ck-body-font)] sm:w-[min(420px,95vw)] sm:rounded-[var(--ck-radius,1rem)] sm:p-6">
        {/* Close */}
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label={t.close}
          className="absolute end-3 top-3 p-2 text-[var(--ck-muted,#9ca3af)] transition-colors hover:text-[var(--ck-fg,#111827)]"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        {step === "phone" && (
          <form onSubmit={handlePhoneSubmit} noValidate>
            <h2 className="pe-8 text-lg [font-family:var(--ck-heading-font)] [font-weight:var(--ck-heading-weight,700)]">
              {title}
            </h2>
            <p className="mt-1 text-sm text-[var(--ck-muted,#6b7280)]">
              {subtitle}
            </p>
            <div className="mt-4">
              <Field label={t.phoneLabel} required>
                {/* One combined field: borderless dial-code select + tel
                    input inside a single rounded frame (per design). */}
                <div
                  dir="ltr"
                  className="flex items-stretch overflow-hidden rounded-xl border border-[var(--ck-border,rgba(0,0,0,0.2))] bg-[var(--ck-surface,#fff)] transition-colors focus-within:border-[var(--ck-ring,#7c3aed)] focus-within:ring-2 focus-within:ring-[var(--ck-ring,#7c3aed)]/20"
                >
                  <select
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    aria-label="Country code"
                    className="shrink-0 border-0 bg-transparent ps-3 pe-1 py-3 text-sm outline-none"
                  >
                    {COUNTRIES.map(([codeC]) => (
                      <option key={codeC} value={codeC}>
                        {DIAL[codeC]}
                      </option>
                    ))}
                  </select>
                  <input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    dir="ltr"
                    value={localPhone}
                    onChange={(e) => setLocalPhone(e.target.value)}
                    placeholder={t.phonePlaceholder}
                    autoFocus
                    className="min-w-0 flex-1 border-0 bg-transparent px-2 py-3 text-sm outline-none placeholder:text-[var(--ck-muted,#9ca3af)]"
                  />
                </div>
              </Field>
            </div>
            {error && (
              <div className="mt-3">
                <ErrorBanner>{error}</ErrorBanner>
              </div>
            )}
            <div className="mt-5">
              <PrimaryButton
                type="submit"
                disabled={busy}
                className="w-full rounded-xl"
              >
                {busy
                  ? t.sending
                  : variant === "save-cart"
                    ? t.saveCart
                    : t.sendCode}
              </PrimaryButton>
            </div>
            {variant === "save-cart" && (
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="mt-3 w-full text-center text-sm text-[var(--ck-muted,#6b7280)] underline-offset-2 hover:underline"
              >
                {t.notNow}
              </button>
            )}
          </form>
        )}

        {step === "code" && (
          <form onSubmit={handleVerify} noValidate>
            <h2 className="pe-8 text-lg [font-family:var(--ck-heading-font)] [font-weight:var(--ck-heading-weight,700)]">
              {t.codeTitle}
            </h2>
            {/* Full number, accent-colored, per design — the shopper typed
                it seconds ago; masking here only causes doubt. */}
            <p className="mt-1 text-sm text-[var(--ck-muted,#6b7280)]">
              {t.codeSubtitlePrefix}{" "}
              <span
                dir="ltr"
                className="font-semibold text-[var(--ck-button,#7c3aed)]"
              >
                {composed}
              </span>{" "}
              {t.codeSubtitleSuffix}
            </p>
            <div className="mt-4">
              {/* Four dedicated boxes (per design). One REAL invisible input
                  drives them — that keeps the numeric mobile keyboard, paste,
                  and one-time-code autofill working, which N separate inputs
                  routinely break. Boxes always render LTR: digit sequences
                  don't mirror in RTL. */}
              <div dir="ltr" className="relative">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={OTP_LENGTH}
                  value={code}
                  onChange={(e) =>
                    setCode(
                      e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH),
                    )
                  }
                  autoFocus
                  aria-label={t.codeLabel}
                  className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
                />
                <div className="flex justify-center gap-3">
                  {Array.from({ length: OTP_LENGTH }, (_, i) => (
                    <div
                      key={i}
                      aria-hidden
                      className={`flex h-14 w-12 items-center justify-center rounded-xl border text-xl font-semibold transition-colors ${
                        i === Math.min(code.length, OTP_LENGTH - 1) && !busy
                          ? "border-[var(--ck-ring,#7c3aed)] ring-2 ring-[var(--ck-ring,#7c3aed)]/20"
                          : "border-[var(--ck-border,rgba(0,0,0,0.2))]"
                      } bg-[var(--ck-surface,#fff)]`}
                    >
                      {code[i] ?? (
                        <span className="text-[var(--ck-muted,#d1d5db)]">
                          {i === code.length ? "|" : ""}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            {error && (
              <div className="mt-3">
                <ErrorBanner>{error}</ErrorBanner>
              </div>
            )}
            <div className="mt-5">
              <PrimaryButton
                type="submit"
                disabled={busy || code.length < OTP_LENGTH}
                className="w-full rounded-xl"
              >
                {busy ? t.verifying : t.verify}
              </PrimaryButton>
            </div>
            <div className="mt-3 flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={() => {
                  setStep("phone");
                  setError(null);
                }}
                className="text-[var(--ck-muted,#6b7280)] underline-offset-2 hover:underline"
              >
                {t.changePhone}
              </button>
              <button
                type="button"
                disabled={busy || resendLeft > 0}
                onClick={() => void issue(composed)}
                className="text-[var(--ck-fg,#111827)] underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:text-[var(--ck-muted,#9ca3af)]"
              >
                {resendLeft > 0 ? t.resendIn(resendLeft) : t.resend}
              </button>
            </div>
          </form>
        )}

        {step === "done" && (
          <div className="py-6 text-center">
            <p className="text-lg [font-family:var(--ck-heading-font)] [font-weight:var(--ck-heading-weight,700)]">
              {doneMessage}
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
