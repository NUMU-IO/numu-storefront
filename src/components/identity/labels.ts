/**
 * Bilingual copy for the phone-first identity dialog + save-cart nudge.
 * Same externalized-labels pattern as components/checkout/location/labels.ts.
 */

export type IdentityLocale = "en" | "ar";

export function identityLabels(locale: IdentityLocale) {
  const ar = locale === "ar";
  return {
    // ── Phone step — checkout variant ──────────────────────────────
    titleCheckout: ar ? "أكد رقم موبايلك" : "Verify your phone",
    subtitleCheckout: ar
      ? "هنبعت لك كود تأكيد على واتساب لإتمام الطلب."
      : "We'll send a WhatsApp code to confirm your order.",
    // ── Phone step — save-cart variant ─────────────────────────────
    titleSaveCart: ar ? "احفظ سلتك 🛒" : "Save your cart 🛒",
    subtitleSaveCart: ar
      ? "اكتب رقم واتساب وهنحفظ لك سلتك — ونفكرك لو سبتها."
      : "Enter your WhatsApp number and we'll keep your cart safe — and remind you if you leave it behind.",
    phoneLabel: ar ? "رقم الموبايل (واتساب)" : "Phone number (WhatsApp)",
    phonePlaceholder: ar ? "01xxxxxxxxx" : "01xxxxxxxxx",
    phoneInvalid: ar ? "رقم الموبايل غير صحيح" : "Please enter a valid phone number",
    sendCode: ar ? "ابعت الكود" : "Send code",
    sending: ar ? "جاري الإرسال…" : "Sending…",
    saveCart: ar ? "احفظ سلتي" : "Save my cart",
    notNow: ar ? "لاحقاً" : "Not now",

    // ── Code step ──────────────────────────────────────────────────
    codeTitle: ar ? "اكتب الكود" : "Enter the code",
    codeSubtitle: (masked: string) =>
      ar
        ? `بعتنا كود تأكيد على واتساب ${masked}`
        : `We sent a verification code on WhatsApp to ${masked}`,
    codeLabel: ar ? "كود التحقق" : "Verification code",
    verify: ar ? "تأكيد ومتابعة" : "Verify & continue",
    verifying: ar ? "جاري التأكيد…" : "Verifying…",
    resend: ar ? "إعادة الإرسال" : "Resend code",
    resendIn: (s: number) =>
      ar ? `إعادة الإرسال بعد ${s} ثانية` : `Resend in ${s}s`,
    changePhone: ar ? "تغيير الرقم" : "Change number",

    // ── Verdicts / errors ──────────────────────────────────────────
    wrongCode: (left: number) =>
      ar
        ? `الكود غير صحيح — باقي ${left} ${left === 1 ? "محاولة" : "محاولات"}`
        : `Wrong code — ${left} ${left === 1 ? "attempt" : "attempts"} left`,
    lockedCode: ar
      ? "محاولات كتير غلط. اطلب كود جديد."
      : "Too many wrong attempts. Request a new code.",
    expiredCode: ar ? "الكود انتهت صلاحيته. اطلب كود جديد." : "This code expired. Request a new one.",
    cooldown: (s: number) =>
      ar
        ? `استنى ${s} ثانية قبل إعادة الإرسال`
        : `Please wait ${s}s before requesting another code`,
    hourlyLimit: ar
      ? "وصلت للحد الأقصى من المحاولات — جرب تاني بعد ساعة."
      : "Too many codes requested — try again in an hour.",
    sendFailed: ar
      ? "تعذر إرسال الكود. حاول مرة أخرى."
      : "Couldn't send the code. Please try again.",
    genericError: ar ? "حصل خطأ. حاول مرة أخرى." : "Something went wrong. Please try again.",

    // ── Done ───────────────────────────────────────────────────────
    welcomeBack: (name: string) =>
      ar ? `أهلاً بعودتك يا ${name} 👋` : `Welcome back, ${name} 👋`,
    verified: ar ? "تم تأكيد رقمك ✅" : "Phone verified ✅",
    cartSaved: ar ? "تم حفظ سلتك ✅" : "Your cart is saved ✅",

    close: ar ? "إغلاق" : "Close",
  };
}
