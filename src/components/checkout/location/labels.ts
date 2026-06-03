/**
 * Bilingual copy for the location picker (en + Egyptian Arabic).
 *
 * The V2 bazaar pulled these strings from a per-store `useStoreLabels()`
 * hook. The platform checkout has no such hook, so we keep a small,
 * self-contained bilingual table here keyed by the storefront locale
 * (resolved from `document.documentElement.lang`, the same source the
 * other checkout steps read).
 */

export type LocationLocale = "ar" | "en";

export interface LocationLabels {
  buttonTitle: string;
  buttonTitleEdit: string;
  buttonSubtitle: string;
  buttonAction: string;
  buttonActionEdit: string;
  dialogTitle: string;
  dialogDescription: string;
  privacyNote: string;
  searchPlaceholder: string;
  useMyLocation: string;
  locating: string;
  resolvingAddress: string;
  dragHint: string;
  accuracyPrefix: string;
  confirmButton: string;
  pinnedChipTitle: string;
  edit: string;
  clear: string;
  close: string;
  errDenied: string;
  errTimeout: string;
  errUnavailable: string;
  errUnsupported: string;
}

const AR: LocationLabels = {
  buttonTitle: "حدّد موقع التوصيل على الخريطة",
  buttonTitleEdit: "تعديل موقع التوصيل",
  buttonSubtitle: "يساعد المندوب يوصلك بسرعة ودقة أكبر",
  buttonAction: "تحديد",
  buttonActionEdit: "تعديل",
  dialogTitle: "حدّد موقع التوصيل",
  dialogDescription: "اسحب الخريطة لتحديد موقع التوصيل بدقة.",
  privacyNote: "بنستخدم موقعك لتأكيد عنوان التوصيل بس.",
  searchPlaceholder: "ابحث عن عنوان، حي، أو معلم…",
  useMyLocation: "استخدم موقعي الحالي",
  locating: "جارٍ تحديد موقعك…",
  resolvingAddress: "جارٍ تحديد العنوان…",
  dragHint: "اسحب الخريطة لضبط الدبوس على موقعك بالظبط.",
  accuracyPrefix: "دقة",
  confirmButton: "تأكيد الموقع",
  pinnedChipTitle: "تم تحديد موقع التوصيل",
  edit: "تعديل",
  clear: "إزالة",
  close: "إغلاق",
  errDenied: "لم نستطع الوصول لموقعك. حدد موقعك يدوياً على الخريطة.",
  errTimeout: "استغرق تحديد الموقع وقتاً طويلاً. حدد موقعك يدوياً.",
  errUnavailable: "خدمة الموقع غير متاحة الآن. حدد موقعك يدوياً.",
  errUnsupported: "متصفحك لا يدعم تحديد الموقع. حدد موقعك يدوياً.",
};

const EN: LocationLabels = {
  buttonTitle: "Pin your delivery location on the map",
  buttonTitleEdit: "Edit delivery location",
  buttonSubtitle: "Helps the courier reach you faster and more accurately",
  buttonAction: "Pin",
  buttonActionEdit: "Edit",
  dialogTitle: "Pin your delivery location",
  dialogDescription: "Drag the map to place the pin precisely.",
  privacyNote: "We only use your location to confirm the delivery address.",
  searchPlaceholder: "Search an address, area, or landmark…",
  useMyLocation: "Use my current location",
  locating: "Finding your location…",
  resolvingAddress: "Resolving address…",
  dragHint: "Drag the map to drop the pin exactly on your location.",
  accuracyPrefix: "Accuracy",
  confirmButton: "Confirm location",
  pinnedChipTitle: "Delivery location pinned",
  edit: "Edit",
  clear: "Remove",
  close: "Close",
  errDenied:
    "We couldn't access your location. Drop the pin manually on the map.",
  errTimeout: "Finding your location took too long. Drop the pin manually.",
  errUnavailable: "Location services are unavailable. Drop the pin manually.",
  errUnsupported:
    "Your browser doesn't support location. Drop the pin manually.",
};

export function locationLabels(locale: string): LocationLabels {
  return locale === "ar" ? AR : EN;
}
