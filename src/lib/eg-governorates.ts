/**
 * Egypt's 27 governorates, bilingual (en + Egyptian Arabic).
 *
 * Used by the built-in checkout's address step so customers pick a real
 * governorate from a dropdown (V2 parity) instead of free-typing it — the
 * server-side shipping resolver keys EG zones on the governorate, so a
 * canonical value materially improves rate resolution.
 *
 * `name` (English) is what we store on the order + send to /api/shipping/
 * options; the backend's `resolve_governorate` accepts the English name.
 * `name_ar` is display-only (shown when the storefront locale is Arabic).
 */

export interface EgGovernorate {
  code: string;
  name: string;
  name_ar: string;
}

export const EG_GOVERNORATES: EgGovernorate[] = [
  { code: "cairo", name: "Cairo", name_ar: "القاهرة" },
  { code: "giza", name: "Giza", name_ar: "الجيزة" },
  { code: "alexandria", name: "Alexandria", name_ar: "الإسكندرية" },
  { code: "dakahlia", name: "Dakahlia", name_ar: "الدقهلية" },
  { code: "red_sea", name: "Red Sea", name_ar: "البحر الأحمر" },
  { code: "beheira", name: "Beheira", name_ar: "البحيرة" },
  { code: "fayoum", name: "Fayoum", name_ar: "الفيوم" },
  { code: "gharbia", name: "Gharbia", name_ar: "الغربية" },
  { code: "ismailia", name: "Ismailia", name_ar: "الإسماعيلية" },
  { code: "menofia", name: "Menofia", name_ar: "المنوفية" },
  { code: "minya", name: "Minya", name_ar: "المنيا" },
  { code: "qalyubia", name: "Qalyubia", name_ar: "القليوبية" },
  { code: "new_valley", name: "New Valley", name_ar: "الوادي الجديد" },
  { code: "suez", name: "Suez", name_ar: "السويس" },
  { code: "aswan", name: "Aswan", name_ar: "أسوان" },
  { code: "assiut", name: "Assiut", name_ar: "أسيوط" },
  { code: "beni_suef", name: "Beni Suef", name_ar: "بني سويف" },
  { code: "port_said", name: "Port Said", name_ar: "بورسعيد" },
  { code: "damietta", name: "Damietta", name_ar: "دمياط" },
  { code: "sharqia", name: "Sharqia", name_ar: "الشرقية" },
  { code: "south_sinai", name: "South Sinai", name_ar: "جنوب سيناء" },
  { code: "kafr_el_sheikh", name: "Kafr El Sheikh", name_ar: "كفر الشيخ" },
  { code: "matrouh", name: "Matrouh", name_ar: "مطروح" },
  { code: "luxor", name: "Luxor", name_ar: "الأقصر" },
  { code: "qena", name: "Qena", name_ar: "قنا" },
  { code: "north_sinai", name: "North Sinai", name_ar: "شمال سيناء" },
  { code: "sohag", name: "Sohag", name_ar: "سوهاج" },
];

/** Localized label for a governorate row. */
export function governorateLabel(g: EgGovernorate, locale: string): string {
  return locale === "ar" ? g.name_ar : g.name;
}
