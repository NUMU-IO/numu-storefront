/**
 * resolveApiError — turn ANY NUMU API error response into a clean, localized,
 * human-readable message so the buyer NEVER sees a raw `{code,message}`
 * envelope (the bug this fixes: the checkout review step JSON.stringify'd
 * `body.error` and rendered `{"code":"HTTP_ERROR","message":"…"}`).
 *
 * NUMU's backend wraps every error as:
 *   { success:false, error:{ code, message, message_en?, message_ar?,
 *                            details?, errors? } }
 * but proxies / older routes can still return `{ detail:{…} }`,
 * `{ detail:"…" }`, `{ error:"…" }`, `{ message:"…" }`, or a bare string —
 * and a thrown `Error` carries its message. We tolerate all of them, parse a
 * JSON body that arrived as a string, and fall back to a status-based generic
 * so there is always SOMETHING friendly to show.
 *
 * Returns the resolved `message` plus the backend `code` (when present) so
 * callers can still branch (e.g. `code === "cod_trust_blocked"`).
 */

export interface ResolvedApiError {
  message: string;
  code: string | null;
}

type Bag = Record<string, unknown>;

function isObj(v: unknown): v is Bag {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** A string body might itself be a JSON envelope — try to parse it. */
function maybeParse(v: string): unknown {
  const s = v.trim();
  if (
    (s.startsWith("{") && s.endsWith("}")) ||
    (s.startsWith("[") && s.endsWith("]"))
  ) {
    try {
      return JSON.parse(s);
    } catch {
      /* not JSON — keep the string */
    }
  }
  return v;
}

/** Pick the locale-appropriate message off an error container. */
function pickMessage(c: Bag, isAr: boolean): string | null {
  const en = typeof c.message_en === "string" ? c.message_en : null;
  const ar = typeof c.message_ar === "string" ? c.message_ar : null;
  const generic = typeof c.message === "string" ? c.message : null;
  const ordered = isAr ? [ar, generic, en] : [en, generic, ar];
  for (const m of ordered) if (m && m.trim()) return m.trim();
  return null;
}

/** Friendly localized copy keyed on the backend error CODE (highest priority). */
const BY_CODE: Record<string, { en: string; ar: string }> = {
  custom_field_errors: {
    en: "Please check the required checkout fields and try again.",
    ar: "راجِع الحقول المطلوبة في صفحة الدفع وحاول مرة أخرى.",
  },
  VALIDATION_ERROR: {
    en: "Please check the details you entered and try again.",
    ar: "راجِع البيانات اللي دخلتها وحاول مرة أخرى.",
  },
};

/** Friendly localized copy matched on the MESSAGE text — for generic
 *  HTTPExceptions that only carry an English string. */
const BY_PATTERN: Array<{ test: RegExp; en: string; ar: string }> = [
  {
    test: /insufficient stock|out of stock|not in stock|no longer available|sold out|not available in the selected/i,
    en: "Sorry — an item in your cart just sold out or doesn't have enough stock left. Please lower the quantity (or remove it) and try again.",
    ar: "نأسف — نفدت كمية أحد المنتجات في سلتك أو لم تعد كافية. قلّل الكمية أو احذف المنتج وحاول مرة أخرى.",
  },
  {
    test: /shipping option|shipping rate|shipping method|select a shipping/i,
    en: "Please choose a shipping option for your address before placing the order.",
    ar: "اختر طريقة شحن لعنوانك قبل تأكيد الطلب.",
  },
  {
    test: /governorate/i,
    en: "We couldn't match your address to a supported governorate — please pick one from the list.",
    ar: "تعذّر مطابقة عنوانك بمحافظة مدعومة — اختر محافظة من القائمة.",
  },
  {
    test: /cash on delivery|\bcod\b/i,
    en: "Cash on Delivery isn't available for this order. Please choose another payment method.",
    ar: "الدفع عند الاستلام غير متاح لهذا الطلب. اختر طريقة دفع أخرى.",
  },
  {
    test: /coupon|discount code/i,
    en: "That discount code can't be applied to this order.",
    ar: "لا يمكن تطبيق كود الخصم على هذا الطلب.",
  },
  {
    test: /gift card/i,
    en: "That gift card isn't valid or has no balance left.",
    ar: "بطاقة الهدايا غير صالحة أو لا يوجد بها رصيد كافٍ.",
  },
  {
    test: /out of stock|stock/i,
    en: "Your cart changed — please review the items and try again.",
    ar: "تغيّرت سلتك — راجِع المنتجات وحاول مرة أخرى.",
  },
];

function genericForStatus(status: number, isAr: boolean): string {
  if (status === 409)
    return isAr
      ? "تغيّرت حالة سلتك (المخزون أو السعر). راجِع الطلب وحاول مرة أخرى."
      : "Your cart changed (stock or pricing). Please review and try again.";
  if (status === 429)
    return isAr
      ? "محاولات كثيرة. استنّى لحظة وحاول مرة أخرى."
      : "Too many attempts. Please wait a moment and try again.";
  if (status >= 500)
    return isAr
      ? "حصل خطأ مؤقت عندنا. حاول مرة أخرى بعد لحظات."
      : "Something went wrong on our side. Please try again in a moment.";
  if (status === 401 || status === 403)
    return isAr
      ? "العملية دي مش مسموح بيها دلوقتي. حدّث الصفحة وحاول مرة أخرى."
      : "That action isn't allowed right now. Please refresh and try again.";
  return isAr
    ? "تعذّر إتمام العملية. راجِع بياناتك وحاول مرة أخرى."
    : "We couldn't complete that. Please check your details and try again.";
}

export function resolveApiError(
  payload: unknown,
  status = 0,
  locale = "en",
): ResolvedApiError {
  const isAr = locale === "ar";

  // 1. Normalize Error / string → object-or-string.
  let p: unknown = payload;
  if (p instanceof Error) p = p.message;
  if (typeof p === "string") p = maybeParse(p);

  // 2. Locate the error container, its code, and a raw message.
  let code: string | null = null;
  let rawMessage: string | null = null;

  if (typeof p === "string") {
    rawMessage = p;
  } else if (isObj(p)) {
    if (typeof p.error === "string") rawMessage = p.error;
    else if (typeof p.detail === "string") rawMessage = p.detail;
    const container = isObj(p.error) ? p.error : isObj(p.detail) ? p.detail : p;
    if (isObj(container)) {
      if (typeof container.code === "string") code = container.code;
      rawMessage = pickMessage(container, isAr) ?? rawMessage;
    }
  }

  // 3. Friendly mapping — code first, then message pattern.
  if (code && BY_CODE[code]) {
    return { message: isAr ? BY_CODE[code].ar : BY_CODE[code].en, code };
  }
  if (rawMessage) {
    for (const r of BY_PATTERN) {
      if (r.test.test(rawMessage)) return { message: isAr ? r.ar : r.en, code };
    }
    // 4. Already-human message → show as-is, but guard against a stringified
    //    object / lone CODE token leaking through.
    const looksHuman =
      /\s/.test(rawMessage) &&
      !rawMessage.startsWith("{") &&
      !rawMessage.startsWith("[");
    if (looksHuman) return { message: rawMessage, code };
  }

  // 5. Nothing usable → status-based generic.
  return { message: genericForStatus(status, isAr), code };
}
