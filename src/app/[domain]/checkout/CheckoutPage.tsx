"use client";

/**
 * Single-page checkout (bazaar-parity).
 *
 * One page, two columns: the order summary (items + coupon + totals +
 * Confirm Order) and the delivery + payment form. Replaces the former 4-step
 * routed flow (contact → shipping → payment → review) so there's no
 * step-to-step navigation. All the wiring is preserved: merchant checkout-field
 * config (standard + custom), Google-Maps pin, zone-resolved shipping, the
 * enabled payment methods (COD + deposit, Paymob Pixel, Kashier, InstaPay,
 * Fawry…), saved cards, gift cards, coupons, and inline validation.
 */

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  CheckoutCard,
  ErrorBanner,
  Field,
  INPUT_INVALID,
  OptionRow,
  PrimaryButton,
  Select,
  Textarea,
  TextInput,
} from "@/components/checkout/ui";
import {
  LocationButton,
  LocationDialog,
  LocationPinnedChip,
  canUseMaps,
  onMapsUnavailable,
  type CapturedLocation,
} from "@/components/checkout/location";
import {
  clearCheckoutState,
  patchCheckoutState,
  readCheckoutState,
} from "@/lib/checkout-state";
import { EG_GOVERNORATES, governorateLabel } from "@/lib/eg-governorates";
import { getSessionFingerprint, trackFunnel } from "@/lib/meta-pixel";
import {
  fetchCheckoutFieldsConfig,
  stdField,
  validateCustomFieldValues,
  type CheckoutFieldsConfig,
  type CustomFieldCfg,
} from "@/lib/checkout-fields";
import { OrderSummary } from "@/components/checkout/OrderSummary";
import { PaymobPixel } from "@/components/checkout/PaymobPixel";
import { KashierCheckout } from "@/components/checkout/KashierCheckout";
import {
  InstaPayInstructions,
  type InstaPayPayload,
} from "@/components/checkout/InstaPayInstructions";
import { useAttribution } from "@/components/layout/AttributionProvider";
import type { CheckoutResponse, ShippingRateOption } from "@/types/checkout";

const COUNTRIES = [
  ["EG", "Egypt", "مصر"],
  ["AE", "United Arab Emirates", "الإمارات"],
  ["SA", "Saudi Arabia", "السعودية"],
  ["KW", "Kuwait", "الكويت"],
  ["QA", "Qatar", "قطر"],
  ["BH", "Bahrain", "البحرين"],
  ["OM", "Oman", "عُمان"],
  ["JO", "Jordan", "الأردن"],
  ["LB", "Lebanon", "لبنان"],
] as const;

// International dial codes for the phone-prefix dropdown (keyed by the
// COUNTRIES code above). Default EG (+20).
const DIAL: Record<string, string> = {
  EG: "+20",
  AE: "+971",
  SA: "+966",
  KW: "+965",
  QA: "+974",
  BH: "+973",
  OM: "+968",
  JO: "+962",
  LB: "+961",
};

/**
 * Combine the selected dial code with the typed local number into an E.164-ish
 * string for submission. Numbers the buyer already wrote in international form
 * (leading "+") are left untouched; otherwise the local trunk "0" is stripped
 * and the dial code prepended (e.g. EG + "01001234567" → "+201001234567").
 */
function composePhone(cc: string, local: string): string {
  const trimmed = local.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("+")) return trimmed.replace(/[\s()-]/g, "");
  const dial = DIAL[cc] || "";
  const national = trimmed.replace(/[\s()-]/g, "").replace(/^0+/, "");
  return dial ? `${dial}${national}` : national;
}

// ── Payment config (same normalizer the old PaymentStep used) ──────
interface MethodOption {
  code: string;
  label?: string;
  label_ar?: string;
  requires_deposit?: boolean;
}
interface PaymentConfig {
  methods: MethodOption[];
  cod: { enabled: boolean; deposit_gateways: string[] };
  saved_cards_enabled: boolean;
}
interface RawPaymentConfig {
  enabled_payment_methods?: string[];
  payment_methods?: MethodOption[];
  cod_deposit_policy?: { enabled?: boolean; allowed_gateways?: string[] };
  cod?: { enabled?: boolean; deposit_required?: boolean; deposit_gateways?: string[] };
  saved_cards_enabled?: boolean;
}
interface SavedCard {
  id: string;
  gateway: string;
  display_name: string | null;
  card_brand: string | null;
  last_four: string | null;
}
const SAVED_CARD_GATEWAYS = new Set(["paymob", "paymob_card", "kashier"]);
const FALLBACK_PAYMENT: PaymentConfig = {
  methods: [{ code: "paymob" }, { code: "cod" }],
  cod: { enabled: false, deposit_gateways: [] },
  saved_cards_enabled: true,
};
function normalizePayment(raw: RawPaymentConfig | null | undefined): PaymentConfig {
  if (!raw) return FALLBACK_PAYMENT;
  let methods: MethodOption[] = [];
  if (Array.isArray(raw.payment_methods) && raw.payment_methods.length > 0) {
    methods = raw.payment_methods.filter((m) => m && m.code);
  } else if (Array.isArray(raw.enabled_payment_methods)) {
    methods = raw.enabled_payment_methods.map((code) => ({ code }));
  }
  const codEnabled = Boolean(
    raw.cod?.deposit_required ?? raw.cod?.enabled ?? raw.cod_deposit_policy?.enabled,
  );
  const depositGateways =
    raw.cod?.deposit_gateways ?? raw.cod_deposit_policy?.allowed_gateways ?? [];
  return {
    methods,
    cod: { enabled: codEnabled, deposit_gateways: depositGateways },
    saved_cards_enabled: raw.saved_cards_enabled ?? true,
  };
}
function methodLabel(opt: MethodOption | string, isAr: boolean): string {
  const code = typeof opt === "string" ? opt : opt.code;
  if (typeof opt === "object") {
    const merchant = isAr ? opt.label_ar : opt.label;
    if (merchant) return merchant;
  }
  const labels: Record<string, [string, string]> = {
    paymob: ["Credit / debit card", "بطاقة ائتمان / خصم"],
    paymob_card: ["Credit / debit card", "بطاقة ائتمان / خصم"],
    kashier: ["Credit / debit card", "بطاقة ائتمان / خصم"],
    moyasar: ["Card / mada / Apple Pay", "بطاقة / مدى / Apple Pay"],
    fawry: ["Fawry", "فوري"],
    fawaterak: ["Fawaterak", "فواتيرك"],
    instapay: ["InstaPay", "انستاباي"],
    cod: ["Cash on delivery", "الدفع عند الاستلام"],
  };
  const entry = labels[code];
  return entry ? (isAr ? entry[1] : entry[0]) : code;
}
function methodSubLabel(code: string, isAr: boolean): string {
  const map: Record<string, [string, string]> = {
    cod: ["Pay cash when it arrives", "ادفع نقدًا عند الاستلام"],
    paymob: ["Visa / Mastercard / wallet", "فيزا / ماستركارد / محفظة"],
    paymob_card: ["Visa / Mastercard", "فيزا / ماستركارد"],
    kashier: ["Visa / Mastercard", "فيزا / ماستركارد"],
    instapay: ["Bank transfer via InstaPay", "تحويل بنكي عبر انستاباي"],
    fawry: ["Pay at any Fawry outlet", "ادفع في أي منفذ فوري"],
  };
  const e = map[code];
  return e ? (isAr ? e[1] : e[0]) : "";
}

const T = {
  checkout: { en: "Checkout", ar: "إتمام الطلب" },
  delivery: { en: "Delivery details", ar: "بيانات التوصيل" },
  payment: { en: "Payment method", ar: "طريقة الدفع" },
  shipping: { en: "Shipping method", ar: "طريقة الشحن" },
  email: { en: "Email", ar: "البريد الإلكتروني" },
  phone: { en: "Phone Number", ar: "رقم الهاتف" },
  firstName: { en: "First Name", ar: "الاسم الأول" },
  lastName: { en: "Last Name", ar: "اسم العائلة" },
  address: { en: "Detailed Address", ar: "العنوان بالتفصيل" },
  apt: { en: "Apartment, suite, etc. (optional)", ar: "شقة، مبنى، إلخ (اختياري)" },
  city: { en: "City", ar: "المدينة" },
  governorate: { en: "Governorate", ar: "المحافظة" },
  selectGov: { en: "Select governorate", ar: "اختر المحافظة" },
  postal: { en: "Postal code", ar: "الرمز البريدي" },
  optional: { en: "optional", ar: "اختياري" },
  country: { en: "Country", ar: "الدولة" },
  additional: { en: "Additional details", ar: "تفاصيل إضافية" },
  loadingShip: { en: "Loading shipping options…", ar: "جارٍ تحميل خيارات الشحن…" },
  noRates: { en: "No shipping options available for this address.", ar: "لا توجد خيارات شحن متاحة لهذا العنوان." },
  selectGovFirst: { en: "Select your governorate to see shipping options.", ar: "اختر محافظتك لعرض خيارات الشحن." },
  free: { en: "Free", ar: "مجاناً" },
  days: { en: "business days", ar: "أيام عمل" },
  loadingPay: { en: "Loading payment options…", ar: "جارٍ تحميل خيارات الدفع…" },
  noPay: { en: "No payment methods configured for this store.", ar: "لا توجد طرق دفع مفعّلة لهذا المتجر." },
  savedCards: { en: "Saved cards", ar: "البطاقات المحفوظة" },
  newCard: { en: "Enter a new card", ar: "إدخال بطاقة جديدة" },
  codDeposit: { en: "COD deposit gateway", ar: "بوابة عربون الدفع عند الاستلام" },
  pickGateway: { en: "— pick gateway —", ar: "— اختر بوابة —" },
  confirm: { en: "Confirm Order", ar: "تأكيد الطلب" },
  placing: { en: "Placing order…", ar: "جارٍ تأكيد الطلب…" },
  pinTitle: { en: "Pin your location on the map", ar: "حدد موقعك على الخريطة" },
  pinDesc: { en: "So we reach you fast and accurately", ar: "علشان نوصلك بسرعة وبدقة" },
  pinCta: { en: "Pin", ar: "تحديد" },
  reqField: { en: "This field is required", ar: "هذا الحقل مطلوب" },
  phoneReq: { en: "Phone number is required", ar: "رقم الهاتف مطلوب" },
  nameShort: { en: "Too short", ar: "قصير جداً" },
  addrShort: {
    en: "Address must be at least 10 characters",
    ar: "العنوان يجب ألا يقل عن ١٠ أحرف",
  },
  govReq: { en: "Governorate is required", ar: "المحافظة مطلوبة" },
  pickMethod: { en: "Pick a payment method.", ar: "اختر طريقة دفع." },
  pickGatewayErr: { en: "Pick a gateway for the COD deposit.", ar: "اختر بوابة دفع للعربون." },
  noShip: { en: "No shipping available for this address.", ar: "لا يوجد شحن متاح لهذا العنوان." },
  waConsent: {
    en: "Send me WhatsApp updates (offers, restocks). Reply STOP anytime.",
    ar: "ابعتلي تحديثات واتساب (عروض ووصول منتجات). ابعت STOP في أي وقت.",
  },
} as const;

// ── Inline icons (numu-storefront ships no icon library) ───────────
function PayIcon({ code }: { code: string }) {
  // Cash banknote for COD; a generic card for every online method.
  if (code === "cod" || code === "fawry") {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-[var(--ck-fg)]">
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M6 12h.01M18 12h.01" />
      </svg>
    );
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-[var(--ck-fg)]">
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="shrink-0 text-[var(--ck-accent)]">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function CheckoutPage() {
  const router = useRouter();
  const params = useParams() as { domain: string };
  const attribution = useAttribution();
  const [locale, setLocale] = useState("en");
  const isAr = locale === "ar";
  const t = (k: keyof typeof T) => (isAr ? T[k].ar : T[k].en);

  // Contact + address
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneCc, setPhoneCc] = useState("EG");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [stateGov, setStateGov] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("EG");
  const [whatsappConsent, setWhatsappConsent] = useState(false);
  const [captured, setCaptured] = useState<CapturedLocation | null>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [mapsEnabled, setMapsEnabled] = useState(false);

  // Merchant field config + custom values
  const [fieldsConfig, setFieldsConfig] = useState<CheckoutFieldsConfig | null>(null);
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const clearErr = (key: string) =>
    setFieldErrors((p) => {
      if (!(key in p)) return p;
      const { [key]: _omit, ...rest } = p;
      return rest;
    });

  // Shipping
  const [rates, setRates] = useState<ShippingRateOption[] | null>(null);
  const [selectedRate, setSelectedRate] = useState<string | null>(null);
  const [shippingLoading, setShippingLoading] = useState(false);

  // Payment
  const [payConfig, setPayConfig] = useState<PaymentConfig | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [depositGateway, setDepositGateway] = useState<string | null>(null);
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [savedCardId, setSavedCardId] = useState<string | null>(null);

  // Submit + overlays
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codBlocked, setCodBlocked] = useState(false);
  const [pixelData, setPixelData] = useState<{
    clientSecret: string;
    publicKey: string;
    orderId: string;
    orderNumber: string;
  } | null>(null);
  const [kashierData, setKashierData] = useState<{
    sessionUrl: string;
    amount?: string;
    currency?: string;
    orderId: string;
    orderNumber: string;
  } | null>(null);
  const [instapayData, setInstapayData] = useState<{
    data: InstaPayPayload;
    orderId: string;
    orderNumber: string;
  } | null>(null);

  const governorate = (stateGov || city || "").trim();

  // ── Mount: locale, hydrate, config, prefill ──────────────────────
  useEffect(() => {
    if (typeof document !== "undefined") {
      setLocale(document.documentElement.lang === "ar" ? "ar" : "en");
    }
    setMapsEnabled(canUseMaps());
    const unsubMaps = onMapsUnavailable(() => setMapsEnabled(false));

    const s = readCheckoutState();
    setEmail(s.email);
    setPhone(s.phone);
    setFirstName(s.shipping_address?.first_name || "");
    setLastName(s.shipping_address?.last_name || "");
    setLine1(s.shipping_address?.address_line1 || "");
    setLine2(s.shipping_address?.address_line2 || "");
    setCity(s.shipping_address?.city || "");
    setStateGov(s.shipping_address?.state || "");
    setPostalCode(s.shipping_address?.postal_code || "");
    setCountry(s.shipping_address?.country || "EG");
    setCustomValues(s.custom_fields || {});
    if (s.shipping_address?.latitude != null && s.shipping_address?.longitude != null) {
      setCaptured({
        lat: s.shipping_address.latitude,
        lng: s.shipping_address.longitude,
        accuracy: s.shipping_address.location_accuracy ?? 50,
        source:
          (s.shipping_address.location_source as CapturedLocation["source"]) ||
          "manual_pin",
        formatted_address: s.shipping_address.geocoded_address || undefined,
      });
    }

    void fetchCheckoutFieldsConfig().then(setFieldsConfig);

    // Payment config + saved cards.
    (async () => {
      let savedEnabled = true;
      try {
        const res = await fetch("/api/storefront/checkout-config", { cache: "no-store" });
        if (res.ok) {
          const body = await res.json();
          const norm = normalizePayment((body?.data || body) as RawPaymentConfig);
          const cfg = norm.methods.length > 0 ? norm : FALLBACK_PAYMENT;
          setPayConfig(cfg);
          savedEnabled = cfg.saved_cards_enabled;
          // Default the method to the first enabled (COD if present).
          setMethod((prev) => prev || cfg.methods.find((m) => m.code === "cod")?.code || cfg.methods[0]?.code || null);
        } else {
          setPayConfig(FALLBACK_PAYMENT);
          setMethod((prev) => prev || "cod");
        }
      } catch {
        setPayConfig(FALLBACK_PAYMENT);
        setMethod((prev) => prev || "cod");
      }
      if (savedEnabled) {
        try {
          const storeRes = await fetch("/api/storefront/store", { cache: "no-store" }).catch(() => null);
          let storeId: string | null = null;
          if (storeRes?.ok) {
            const body = await storeRes.json();
            storeId = (body?.data?.id || body?.id || null) as string | null;
          }
          if (storeId) {
            const cardsRes = await fetch(
              `/api/customer/saved-cards?store_id=${encodeURIComponent(storeId)}`,
              { cache: "no-store" },
            );
            if (cardsRes.ok) {
              const body = await cardsRes.json();
              const list = (body?.data || body || []) as SavedCard[];
              setSavedCards(Array.isArray(list) ? list : []);
            }
          }
        } catch {
          /* saved cards optional */
        }
      }
    })();

    // Best-effort customer prefill.
    (async () => {
      try {
        const res = await fetch("/api/customer/me", { cache: "no-store" });
        if (res.ok) {
          const body = await res.json();
          const c = body?.data || body;
          if (c?.email && !s.email) setEmail(c.email);
          if (c?.phone && !s.phone) setPhone(c.phone);
        }
      } catch {
        /* anonymous */
      }
    })();

    return () => unsubMaps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Shipping options: refetch on governorate / cart / COD change ──
  const codRequested = method === "cod";
  useEffect(() => {
    if (!governorate) {
      setRates(null);
      return;
    }
    let cancelled = false;
    setShippingLoading(true);
    (async () => {
      let cartSubtotalCents = 0;
      try {
        const cartRes = await fetch("/api/cart", { cache: "no-store" });
        if (cartRes.ok) {
          const cb = await cartRes.json();
          const cart = (cb?.data || cb) as {
            subtotal?: number;
            items?: Array<{ total_price?: number; subtotal?: number; unit_price?: number; quantity: number }>;
          };
          cartSubtotalCents =
            cart?.subtotal ??
            cart?.items?.reduce(
              (acc, l) => acc + (l.total_price ?? l.subtotal ?? (l.unit_price ?? 0) * l.quantity),
              0,
            ) ??
            0;
        }
      } catch {
        /* free/flat rates still resolve */
      }
      try {
        const res = await fetch("/api/shipping/options", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            governorate_code: governorate,
            cart_subtotal_cents: cartSubtotalCents,
            cart_weight_g: 0,
            cod_requested: codRequested,
          }),
        });
        if (cancelled) return;
        if (!res.ok) {
          setRates([]);
        } else {
          const body = await res.json();
          const raw = (body?.data?.options || body?.options || body?.data || []) as Array<
            Record<string, unknown>
          >;
          const list: ShippingRateOption[] = (Array.isArray(raw) ? raw : []).map((o) => ({
            id: String(o.rate_id ?? o.id ?? ""),
            name: String((isAr && o.label_ar ? o.label_ar : o.label ?? o.name) ?? ""),
            amount_cents: Number(o.amount_cents ?? 0),
            currency: String(o.currency ?? "EGP"),
            estimated_days_min: (o.estimated_days_min as number | null | undefined) ?? null,
            estimated_days_max: (o.estimated_days_max as number | null | undefined) ?? null,
            carrier: (o.carrier as string | null | undefined) ?? null,
          }));
          setRates(list);
          setSelectedRate((prev) => {
            if (prev && list.some((r) => r.id === prev)) return prev;
            const cheapest = [...list].sort((a, b) => a.amount_cents - b.amount_cents)[0];
            return cheapest?.id ?? null;
          });
        }
      } catch {
        if (!cancelled) setRates([]);
      } finally {
        if (!cancelled) setShippingLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [governorate, codRequested]);

  // Keep the OrderSummary's shipping line + total in sync with the selection.
  useEffect(() => {
    if (!selectedRate) return;
    const rate = rates?.find((r) => r.id === selectedRate);
    if (rate) {
      patchCheckoutState({
        shipping_cost_cents: rate.amount_cents,
        shipping_method: rate.name,
      });
    }
  }, [selectedRate, rates]);

  function setCustom(id: string, v: unknown) {
    setCustomValues((prev) => ({ ...prev, [id]: v }));
    clearErr(`cf:${id}`);
  }

  function applyCapturedLocation(loc: CapturedLocation) {
    setCaptured(loc);
    if (country === "EG" && loc.city_code && loc.city_code !== "Other") {
      setStateGov(loc.city_code);
    } else if (country !== "EG" && loc.city) {
      setStateGov(loc.city);
    }
    if (loc.city) setCity(loc.city);
    if (loc.street) setLine1(loc.street);
    else if (loc.formatted_address) setLine1(loc.formatted_address);
    if (loc.area && !line2) setLine2(loc.area);
  }

  // ── Place order ──────────────────────────────────────────────────
  async function placeOrder(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCodBlocked(false);

    // Delivery validation (config-driven; phone is our identity source-of-truth).
    const errs: Record<string, string> = {};
    const reqMsg = t("reqField");
    const emailCfg = stdField(fieldsConfig, "email");
    const lastCfg = stdField(fieldsConfig, "last_name");
    const areaCfg = stdField(fieldsConfig, "area");
    const landmarkCfg = stdField(fieldsConfig, "landmark");
    if (emailCfg.enabled && emailCfg.required && !email.trim()) errs.email = reqMsg;
    else if (email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))
      errs.email = isAr ? "بريد إلكتروني غير صحيح" : "Enter a valid email";
    if (stdField(fieldsConfig, "phone").required && !phone.trim()) errs.phone = t("phoneReq");
    else if (
      phone.trim() &&
      // Mirror the backend rule (8–15 digits, optional leading +) so an
      // invalid phone is caught inline instead of bouncing back as an opaque
      // 422 "Request validation failed" from the order API.
      !/^\+?\d{8,15}$/.test(phone.trim().replace(/[\s()-]/g, ""))
    )
      errs.phone = isAr
        ? "رقم هاتف غير صحيح (٨–١٥ رقمًا)"
        : "Enter a valid phone number (8–15 digits)";
    // Name: a required first name must be a real name, not a single letter.
    if (stdField(fieldsConfig, "first_name").required && firstName.trim().length < 2)
      errs.first_name = t("nameShort");
    if (lastCfg.enabled && lastCfg.required && !lastName.trim()) errs.last_name = reqMsg;
    // Address: a required detailed address needs enough to route a courier.
    if (stdField(fieldsConfig, "address").required && line1.trim().length < 10)
      errs.line1 = t("addrShort");
    if (areaCfg.enabled && areaCfg.required && !city.trim()) errs.city = reqMsg;
    if (landmarkCfg.enabled && landmarkCfg.required && !line2.trim()) errs.line2 = reqMsg;
    if (stdField(fieldsConfig, "governorate").required && !stateGov.trim()) errs.state = t("govReq");
    if (!country) errs.country = reqMsg;
    const customErrors = validateCustomFieldValues(
      fieldsConfig?.custom_fields || [],
      customValues,
      locale,
    );
    for (const [id, msg] of Object.entries(customErrors)) errs[`cf:${id}`] = msg;
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});

    // Phone for submission: prepend the selected dial code (the backend
    // canonicalises to E.164, but sending it pre-composed keeps non-EG numbers
    // correct and matches the prefix the buyer picked).
    const submitPhone = composePhone(phoneCc, phone);

    // Shipping must resolve to a rate.
    if (!selectedRate) {
      setError(t("noShip"));
      return;
    }

    // Payment validation.
    if (!method) {
      setError(t("pickMethod"));
      return;
    }
    const codSelected = method === "cod";
    const depositRequired = codSelected && Boolean(payConfig?.cod.enabled);
    if (depositRequired && !depositGateway) {
      setError(t("pickGatewayErr"));
      return;
    }
    const savedForMethod = savedCards.find(
      (c) =>
        c.id === savedCardId &&
        (c.gateway === method || (c.gateway === "paymob" && method === "paymob_card")),
    );

    setSubmitting(true);

    // Persist a snapshot so a refresh / processing-poll can recover.
    patchCheckoutState({
      email,
      phone: submitPhone,
      shipping_address: {
        first_name: firstName,
        last_name: lastName,
        address_line1: line1,
        address_line2: line2 || null,
        // When the merchant disables the "area"/city field, fall back to the
        // governorate so couriers still have a locality on the label.
        city: city || stateGov,
        state: stateGov || null,
        postal_code: postalCode || null,
        country,
        phone: submitPhone || null,
        ...(captured
          ? {
              latitude: captured.lat,
              longitude: captured.lng,
              location_accuracy: captured.accuracy,
              location_source: captured.source,
              geocoded_address: captured.formatted_address,
            }
          : {}),
      },
      custom_fields: customValues,
      selected_shipping_rate_id: selectedRate,
      payment_method: method,
      cod_requested: codSelected,
      deposit_gateway: depositRequired ? depositGateway : null,
    });

    if (whatsappConsent && submitPhone) {
      void fetch("/api/whatsapp/opt-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: submitPhone }),
      }).catch(() => {});
    }
    trackFunnel("add_payment_info", { payment_method: method });

    try {
      // Resolve cart line items (server cart is authoritative).
      let line_items: Array<{ product_id: string; variant_id: string | null; quantity: number }> = [];
      try {
        const cartRes = await fetch("/api/cart", { cache: "no-store" });
        if (cartRes.ok) {
          const cb = await cartRes.json();
          const items = ((cb?.data || cb)?.items || []) as Array<Record<string, unknown>>;
          line_items = items.map((l) => ({
            product_id: String(l.product_id),
            variant_id: (l.variant_id as string | null) || null,
            quantity: Number(l.quantity) || 1,
          }));
        }
      } catch {
        /* server resolves from the session cart anyway */
      }

      const payload = {
        line_items,
        shipping_address: {
          first_name: firstName,
          last_name: lastName,
          address_line1: line1,
          address_line2: line2 || null,
          city,
          state: stateGov || null,
          postal_code: postalCode || null,
          country,
          phone: submitPhone || null,
          ...(captured
            ? {
                latitude: captured.lat,
                longitude: captured.lng,
                location_accuracy: captured.accuracy,
                location_source: captured.source,
                geocoded_address: captured.formatted_address,
              }
            : {}),
        },
        payment_method: method,
        selected_shipping_rate_id: selectedRate,
        guest_email: email || null,
        cod_requested: codSelected,
        deposit_gateway: depositRequired ? depositGateway : null,
        saved_payment_method_id: savedForMethod?.id || null,
        coupon_code: readCheckoutState().coupon_code || null,
        gift_card_codes: readCheckoutState().gift_card_codes || [],
        ...(Object.keys(customValues).length > 0 ? { custom_fields: customValues } : {}),
        ...(attribution ? { attribution } : {}),
        session_fingerprint: getSessionFingerprint() || null,
      };

      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        const detail = body?.detail;
        if (detail && typeof detail === "object" && detail.code) {
          setError((isAr ? detail.message_ar : detail.message_en) || detail.message_en || `Checkout failed (${res.status})`);
          setCodBlocked(detail.code === "cod_trust_blocked");
          setSubmitting(false);
          return;
        }
        // Our API error envelope is { error: { code, message, details? } }.
        // Never JSON.stringify it at the buyer. The checkout endpoint now
        // returns a sanitized `details: [{field, message, type}]` list, so
        // when present we highlight the offending field inline and show its
        // specific message; otherwise fall back to a friendly hint. Client-
        // side validation above already catches the common phone/email cases.
        const fb = detail || body?.error || `Checkout failed (${res.status})`;
        let msg: string;
        if (typeof fb === "string") {
          msg = fb;
        } else if (fb && typeof fb === "object" && Array.isArray(fb.details) && fb.details.length) {
          // Map backend field paths (e.g. "body.shipping_address.phone") to
          // the form's inline-error keys by their last segment.
          const FIELD_MAP: Record<string, string> = {
            phone: "phone",
            email: "email",
            first_name: "first_name",
            last_name: "last_name",
            city: "city",
            state: "state",
            governorate: "state",
            line1: "line1",
            line2: "line2",
            country: "country",
          };
          const fe: Record<string, string> = {};
          for (const d of fb.details as Array<{ field?: string; message?: string }>) {
            const seg = String(d.field || "").split(".").pop() || "";
            const key = FIELD_MAP[seg];
            if (key && d.message) fe[key] = d.message;
          }
          if (Object.keys(fe).length) setFieldErrors((prev) => ({ ...prev, ...fe }));
          msg =
            (fb.details[0] as { message?: string })?.message ||
            (isAr ? "تأكد من صحة البيانات المُدخلة." : "Please check your details.");
        } else if (fb && typeof fb === "object" && fb.code === "VALIDATION_ERROR") {
          msg = isAr
            ? "تأكد من صحة البيانات المُدخلة (الهاتف، العنوان…) وحاول مرة أخرى."
            : "Please check your details (phone, address…) and try again.";
        } else if (fb && typeof fb === "object" && typeof fb.message === "string") {
          msg = fb.message;
        } else {
          msg = `Checkout failed (${res.status})`;
        }
        setError(msg);
        setSubmitting(false);
        return;
      }

      const data = (body?.data || body) as CheckoutResponse;
      const stashPending = () => {
        try {
          window.sessionStorage.setItem(
            "numu_checkout_pending_order",
            JSON.stringify({ order_id: data.order_id, order_number: data.order_number }),
          );
        } catch {}
      };

      if (data.payment_url) {
        stashPending();
        window.location.assign(data.payment_url);
        return;
      }
      if (data.paymob_client_secret && data.paymob_public_key) {
        stashPending();
        setPixelData({
          clientSecret: data.paymob_client_secret,
          publicKey: data.paymob_public_key,
          orderId: data.order_id,
          orderNumber: data.order_number,
        });
        return;
      }
      const pd = data.payment_data as
        | { provider?: string; session_url?: string; amount?: string; currency?: string }
        | null
        | undefined;
      if (pd && pd.provider === "kashier" && pd.session_url) {
        stashPending();
        setKashierData({
          sessionUrl: pd.session_url,
          amount: pd.amount,
          currency: pd.currency,
          orderId: data.order_id,
          orderNumber: data.order_number,
        });
        return;
      }
      if (pd && pd.provider === "instapay") {
        stashPending();
        setInstapayData({
          data: data.payment_data as unknown as InstaPayPayload,
          orderId: data.order_id,
          orderNumber: data.order_number,
        });
        return;
      }
      clearCheckoutState();
      router.replace(
        `/${params.domain}/checkout/${data.order_id}/thank-you?n=${encodeURIComponent(data.order_number)}`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  // ── Embedded-payment overlays replace the page while paying ───────
  if (pixelData) {
    return (
      <div className="mx-auto max-w-lg py-6">
        <h2 className="mb-1 text-lg font-bold text-gray-900">
          {isAr ? "إتمام الدفع" : "Complete payment"}
        </h2>
        <p className="mb-4 text-sm text-gray-500">
          {isAr ? "طلب رقم" : "Order"} #{pixelData.orderNumber}
        </p>
        <PaymobPixel
          publicKey={pixelData.publicKey}
          clientSecret={pixelData.clientSecret}
          locale={locale}
          onComplete={(ok) => {
            if (ok) {
              clearCheckoutState();
              router.replace(
                `/${params.domain}/checkout/processing?order=${encodeURIComponent(pixelData.orderId)}`,
              );
            } else {
              setError(isAr ? "فشل الدفع. حاول مجددًا." : "Payment failed. Please try again.");
              setPixelData(null);
              setSubmitting(false);
            }
          }}
          onCancel={() => {
            setError(isAr ? "تم إلغاء الدفع." : "Payment cancelled.");
            setPixelData(null);
            setSubmitting(false);
          }}
        />
      </div>
    );
  }
  if (kashierData) {
    return (
      <div className="py-6">
        <KashierCheckout
          sessionUrl={kashierData.sessionUrl}
          amount={kashierData.amount}
          currency={kashierData.currency}
          orderNumber={kashierData.orderNumber}
          locale={locale}
          onCancel={() => {
            setError(isAr ? "تم إلغاء الدفع." : "Payment cancelled.");
            setKashierData(null);
            setSubmitting(false);
          }}
        />
      </div>
    );
  }
  if (instapayData) {
    return (
      <div className="py-6">
        <InstaPayInstructions
          data={instapayData.data}
          orderNumber={instapayData.orderNumber}
          locale={locale}
          onContinue={() => {
            clearCheckoutState();
            router.replace(
              `/${params.domain}/checkout/${instapayData.orderId}/thank-you?n=${encodeURIComponent(instapayData.orderNumber)}`,
            );
          }}
        />
      </div>
    );
  }

  const payMethods = payConfig?.methods || [];
  const showDeposit = method === "cod" && Boolean(payConfig?.cod.enabled);
  const savedForMethod = savedCards.filter(
    (c) =>
      method &&
      SAVED_CARD_GATEWAYS.has(method) &&
      (c.gateway === method || (c.gateway === "paymob" && method === "paymob_card")),
  );

  function formatCents(cents: number, currency: string) {
    try {
      return new Intl.NumberFormat(isAr ? "ar-EG" : "en", { style: "currency", currency }).format(
        cents / 100,
      );
    } catch {
      return `${(cents / 100).toFixed(2)} ${currency}`;
    }
  }

  return (
    <>
      <h1 className="mb-6 text-xl text-[var(--ck-fg)] [font-family:var(--ck-heading-font)] [font-weight:var(--ck-heading-weight)] [letter-spacing:var(--ck-heading-tracking)] [text-transform:var(--ck-heading-transform)]">
        {t("checkout")}
      </h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-10">
        {/* Summary column (left) — includes coupon + totals; Confirm below. */}
        <div className="order-2 lg:order-1">
          <div className="lg:sticky lg:top-8">
            <OrderSummary />
            <PrimaryButton
              type="submit"
              form="checkout-form"
              disabled={submitting}
              className="mt-4 w-full"
            >
              {submitting ? t("placing") : t("confirm")}
              {!submitting && (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              )}
            </PrimaryButton>
            {codBlocked && (
              <p className="mt-2 text-center text-xs text-gray-500">
                {isAr ? "اختر الدفع الأونلاين بالأعلى." : "Choose an online payment method above."}
              </p>
            )}
          </div>
        </div>

        {/* Form column (right) — delivery details + payment. */}
        <form
          id="checkout-form"
          onSubmit={placeOrder}
          className="order-1 space-y-5 lg:order-2"
          noValidate
        >
          <CheckoutCard title={t("delivery")}>
            {/* Map pin */}
            {mapsEnabled && (
              <div className="mb-5">
                {captured ? (
                  <LocationPinnedChip
                    location={captured}
                    locale={locale}
                    onEdit={() => setLocationOpen(true)}
                    onClear={() => setCaptured(null)}
                  />
                ) : (
                  <LocationButton locale={locale} onClick={() => setLocationOpen(true)} />
                )}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {stdField(fieldsConfig, "email").enabled && (
                <Field label={t("email")} htmlFor="email" error={fieldErrors.email} className="sm:col-span-2">
                  <TextInput
                    id="email"
                    type="email"
                    autoComplete="email"
                    required={stdField(fieldsConfig, "email").required}
                    aria-invalid={!!fieldErrors.email}
                    className={fieldErrors.email ? INPUT_INVALID : undefined}
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      clearErr("email");
                    }}
                  />
                </Field>
              )}
              <Field
                label={t("phone")}
                htmlFor="phone"
                error={fieldErrors.phone}
                required={stdField(fieldsConfig, "phone").required}
              >
                <div className="flex gap-2" dir="ltr">
                  <Select
                    aria-label="Country code"
                    value={phoneCc}
                    onChange={(e) => setPhoneCc(e.target.value)}
                    className="w-24 shrink-0 text-center"
                  >
                    {COUNTRIES.map(([code]) => (
                      <option key={code} value={code}>
                        {code} {DIAL[code]}
                      </option>
                    ))}
                  </Select>
                  <TextInput
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="100 123 4567"
                    required={stdField(fieldsConfig, "phone").required}
                    aria-invalid={!!fieldErrors.phone}
                    className={`flex-1 ${fieldErrors.phone ? INPUT_INVALID : ""}`}
                    value={phone}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      clearErr("phone");
                    }}
                    dir="ltr"
                  />
                </div>
              </Field>
              <Field label={t("firstName")} htmlFor="first_name" error={fieldErrors.first_name} required={stdField(fieldsConfig, "first_name").required}>
                <TextInput
                  id="first_name"
                  autoComplete="given-name"
                  placeholder="John"
                  required={stdField(fieldsConfig, "first_name").required}
                  aria-invalid={!!fieldErrors.first_name}
                  className={fieldErrors.first_name ? INPUT_INVALID : undefined}
                  value={firstName}
                  onChange={(e) => {
                    setFirstName(e.target.value);
                    clearErr("first_name");
                  }}
                />
              </Field>
              {stdField(fieldsConfig, "last_name").enabled && (
                <Field label={t("lastName")} htmlFor="last_name" error={fieldErrors.last_name}>
                  <TextInput
                    id="last_name"
                    autoComplete="family-name"
                    required={stdField(fieldsConfig, "last_name").required}
                    aria-invalid={!!fieldErrors.last_name}
                    className={fieldErrors.last_name ? INPUT_INVALID : undefined}
                    value={lastName}
                    onChange={(e) => {
                      setLastName(e.target.value);
                      clearErr("last_name");
                    }}
                  />
                </Field>
              )}
              <Field label={t("address")} htmlFor="line1" className="sm:col-span-2" error={fieldErrors.line1} required={stdField(fieldsConfig, "address").required}>
                <TextInput
                  id="line1"
                  autoComplete="address-line1"
                  placeholder="Street / Building / Apt"
                  required={stdField(fieldsConfig, "address").required}
                  aria-invalid={!!fieldErrors.line1}
                  className={fieldErrors.line1 ? INPUT_INVALID : undefined}
                  value={line1}
                  onChange={(e) => {
                    setLine1(e.target.value);
                    clearErr("line1");
                  }}
                  dir="auto"
                />
              </Field>
              {stdField(fieldsConfig, "landmark").enabled && (
                <Field label={t("apt")} htmlFor="line2" className="sm:col-span-2" error={fieldErrors.line2}>
                  <TextInput
                    id="line2"
                    autoComplete="address-line2"
                    required={stdField(fieldsConfig, "landmark").required}
                    aria-invalid={!!fieldErrors.line2}
                    className={fieldErrors.line2 ? INPUT_INVALID : undefined}
                    value={line2}
                    onChange={(e) => {
                      setLine2(e.target.value);
                      clearErr("line2");
                    }}
                    dir="auto"
                  />
                </Field>
              )}
              <Field label={t("governorate")} htmlFor="state" error={fieldErrors.state} required={stdField(fieldsConfig, "governorate").required}>
                {country === "EG" ? (
                  <Select
                    id="state"
                    autoComplete="address-level1"
                    aria-invalid={!!fieldErrors.state}
                    className={fieldErrors.state ? INPUT_INVALID : undefined}
                    value={stateGov}
                    onChange={(e) => {
                      setStateGov(e.target.value);
                      clearErr("state");
                    }}
                  >
                    <option value="">{t("selectGov")}</option>
                    {EG_GOVERNORATES.map((g) => (
                      <option key={g.code} value={g.name}>
                        {governorateLabel(g, locale)}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <TextInput
                    id="state"
                    autoComplete="address-level1"
                    aria-invalid={!!fieldErrors.state}
                    className={fieldErrors.state ? INPUT_INVALID : undefined}
                    value={stateGov}
                    onChange={(e) => {
                      setStateGov(e.target.value);
                      clearErr("state");
                    }}
                  />
                )}
              </Field>
              {stdField(fieldsConfig, "area").enabled && (
                <Field label={t("city")} htmlFor="city" error={fieldErrors.city}>
                  <TextInput
                    id="city"
                    autoComplete="address-level2"
                    required={stdField(fieldsConfig, "area").required}
                    aria-invalid={!!fieldErrors.city}
                    className={fieldErrors.city ? INPUT_INVALID : undefined}
                    value={city}
                    onChange={(e) => {
                      setCity(e.target.value);
                      clearErr("city");
                    }}
                    dir="auto"
                  />
                </Field>
              )}
              <Field label={`${t("postal")} (${t("optional")})`} htmlFor="postal">
                <TextInput
                  id="postal"
                  autoComplete="postal-code"
                  value={postalCode}
                  onChange={(e) => setPostalCode(e.target.value)}
                  dir="ltr"
                />
              </Field>
              <Field label={t("country")} htmlFor="country" error={fieldErrors.country}>
                <Select
                  id="country"
                  autoComplete="country"
                  value={country}
                  onChange={(e) => {
                    setCountry(e.target.value);
                    clearErr("country");
                  }}
                >
                  {COUNTRIES.map(([code, en, ar]) => (
                    <option key={code} value={code}>
                      {isAr ? ar : en}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {/* WhatsApp consent */}
            <label htmlFor="wa_consent" className="mt-4 flex cursor-pointer select-none items-start gap-2.5">
              <input
                id="wa_consent"
                type="checkbox"
                checked={whatsappConsent}
                disabled={!phone}
                onChange={(e) => setWhatsappConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-gray-900"
              />
              <span className="text-xs leading-snug text-gray-500">{t("waConsent")}</span>
            </label>
          </CheckoutCard>

          {/* Custom fields */}
          {(fieldsConfig?.custom_fields?.length ?? 0) > 0 && (
            <CheckoutCard title={t("additional")}>
              <div className="grid grid-cols-1 gap-4">
                {[...(fieldsConfig?.custom_fields ?? [])]
                  .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
                  .map((f) => (
                    <CustomFieldInput
                      key={f.id}
                      field={f}
                      value={customValues[f.id]}
                      locale={locale}
                      error={fieldErrors[`cf:${f.id}`]}
                      onChange={(v) => setCustom(f.id, v)}
                    />
                  ))}
              </div>
            </CheckoutCard>
          )}

          {/* Shipping method */}
          {governorate && (
            <CheckoutCard title={t("shipping")}>
              {shippingLoading && <p className="text-sm text-gray-500">{t("loadingShip")}</p>}
              {!shippingLoading && rates && rates.length === 0 && (
                <p className="text-sm text-red-700">{t("noRates")}</p>
              )}
              {!shippingLoading && rates && rates.length > 0 && (
                <ul className="space-y-2.5">
                  {rates.map((r) => (
                    <li key={r.id}>
                      <OptionRow htmlFor={`rate-${r.id}`} selected={selectedRate === r.id}>
                        <input
                          id={`rate-${r.id}`}
                          type="radio"
                          name="rate"
                          checked={selectedRate === r.id}
                          onChange={() => setSelectedRate(r.id)}
                          className="h-4 w-4 accent-gray-900"
                        />
                        <span className="flex-1">
                          <span className="block font-medium text-gray-900">{r.name}</span>
                          {(r.estimated_days_min || r.estimated_days_max) && (
                            <span className="text-xs text-gray-500">
                              {r.estimated_days_min ?? "?"}–{r.estimated_days_max ?? "?"} {t("days")}
                            </span>
                          )}
                        </span>
                        <span className="font-medium text-gray-900">
                          {r.amount_cents === 0 ? t("free") : formatCents(r.amount_cents, r.currency)}
                        </span>
                      </OptionRow>
                    </li>
                  ))}
                </ul>
              )}
            </CheckoutCard>
          )}

          {/* Payment method */}
          <CheckoutCard title={t("payment")}>
            {!payConfig && <p className="text-sm text-gray-500">{t("loadingPay")}</p>}
            {payConfig && payMethods.length === 0 && (
              <p className="text-sm text-red-700">{t("noPay")}</p>
            )}
            {payMethods.length > 0 && (
              <ul className="space-y-2.5">
                {payMethods.map((m) => (
                  <li key={m.code}>
                    <OptionRow htmlFor={`m-${m.code}`} selected={method === m.code}>
                      <input
                        id={`m-${m.code}`}
                        type="radio"
                        name="payment"
                        checked={method === m.code}
                        onChange={() => setMethod(m.code)}
                        className="sr-only"
                      />
                      <PayIcon code={m.code} />
                      <span className="flex-1">
                        <span className="block font-medium text-gray-900">
                          {methodLabel(m, isAr)}
                        </span>
                        {methodSubLabel(m.code, isAr) && (
                          <span className="text-xs text-gray-500">
                            {methodSubLabel(m.code, isAr)}
                          </span>
                        )}
                      </span>
                      {method === m.code && <CheckIcon />}
                    </OptionRow>
                  </li>
                ))}
              </ul>
            )}

            {showDeposit && (
              <div className="mt-4">
                <Field label={t("codDeposit")} htmlFor="deposit-gw">
                  <Select
                    id="deposit-gw"
                    value={depositGateway || ""}
                    onChange={(e) => setDepositGateway(e.target.value)}
                    className="max-w-xs"
                  >
                    <option value="">{t("pickGateway")}</option>
                    {(payConfig?.cod.deposit_gateways || []).map((g) => (
                      <option key={g} value={g}>
                        {methodLabel(g, isAr)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}

            {savedForMethod.length > 0 && (
              <div className="mt-4 border-t border-[var(--ck-border)] pt-4">
                <p className="mb-2 text-xs font-medium text-gray-500">{t("savedCards")}</p>
                <ul className="space-y-2.5">
                  <li>
                    <OptionRow selected={savedCardId === null}>
                      <input
                        type="radio"
                        name="saved-card"
                        checked={savedCardId === null}
                        onChange={() => setSavedCardId(null)}
                        className="h-4 w-4 accent-gray-900"
                      />
                      <span className="text-sm text-gray-900">{t("newCard")}</span>
                    </OptionRow>
                  </li>
                  {savedForMethod.map((c) => (
                    <li key={c.id}>
                      <OptionRow selected={savedCardId === c.id}>
                        <input
                          type="radio"
                          name="saved-card"
                          checked={savedCardId === c.id}
                          onChange={() => setSavedCardId(c.id)}
                          className="h-4 w-4 accent-gray-900"
                        />
                        <span className="text-sm text-gray-900">
                          {c.display_name ||
                            `${c.card_brand || "Card"} •••• ${c.last_four || "????"}`}
                        </span>
                      </OptionRow>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CheckoutCard>

          {error && <ErrorBanner>{error}</ErrorBanner>}
        </form>
      </div>

      {(mapsEnabled || locationOpen) && (
        <LocationDialog
          open={locationOpen}
          onOpenChange={setLocationOpen}
          locale={locale}
          onConfirm={applyCapturedLocation}
        />
      )}
    </>
  );
}

/** One merchant-defined custom field, rendered by type. */
function CustomFieldInput({
  field,
  value,
  onChange,
  locale,
  error,
}: {
  field: CustomFieldCfg;
  value: unknown;
  onChange: (v: unknown) => void;
  locale: string;
  error?: string;
}) {
  const isAr = locale === "ar";
  const label = isAr && field.label_ar ? field.label_ar : field.label;
  const labelWithOpt = field.required ? label : `${label} (${isAr ? "اختياري" : "optional"})`;
  const id = `cf-${field.id}`;
  const invalid = error ? INPUT_INVALID : undefined;

  if (field.type === "checkbox") {
    return (
      <div>
        <label htmlFor={id} className="flex cursor-pointer select-none items-start gap-2.5">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-gray-900"
          />
          <span className="text-sm text-gray-700">
            {label}
            {field.required ? " *" : ""}
          </span>
        </label>
        {error && (
          <span className="mt-1 block text-xs font-medium text-red-600" role="alert">
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <Field label={labelWithOpt} htmlFor={id} error={error}>
      {field.type === "textarea" ? (
        <Textarea
          id={id}
          rows={3}
          required={field.required}
          aria-invalid={!!error}
          className={invalid}
          value={String(value ?? "")}
          placeholder={field.placeholder || undefined}
          onChange={(e) => onChange(e.target.value)}
          dir="auto"
        />
      ) : field.type === "select" ? (
        <Select
          id={id}
          required={field.required}
          aria-invalid={!!error}
          className={invalid}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{isAr ? "اختر" : "Select"}</option>
          {(field.options || []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
      ) : (
        <TextInput
          id={id}
          type={field.type === "number" ? "number" : "text"}
          inputMode={field.type === "number" ? "decimal" : undefined}
          required={field.required}
          aria-invalid={!!error}
          className={invalid}
          value={String(value ?? "")}
          placeholder={field.placeholder || undefined}
          onChange={(e) => onChange(e.target.value)}
          dir="auto"
        />
      )}
    </Field>
  );
}
