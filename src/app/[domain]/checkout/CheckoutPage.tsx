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
 * Vodafone Cash, Fawry…), saved cards, gift cards, coupons, and inline
 * validation.
 */

import { useEffect, useRef, useState } from "react";
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
import { PaymentMark } from "@/components/checkout/PaymentMark";
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
import { readCartFunnelData } from "@/lib/cart-funnel-data";
import { claim } from "@/components/tracking/FunnelTracker";
import { suppressCartTracking, trackCartState } from "@/lib/abandoned-cart";
import {
  IdentityDialog,
  type IdentityVerifiedResult,
} from "@/components/identity";
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
  ManualTransferInstructions,
  manualResumePath,
  type ManualTransferPayload,
} from "@/components/checkout/ManualTransferInstructions";
import { useAttribution } from "@/components/layout/AttributionProvider";
import type { CheckoutResponse, ShippingRateOption } from "@/types/checkout";

// Country/dial data + composePhone moved to the shared lib so the identity
// dialog (phone-first OTP) renders the exact same phone input.
import { COUNTRIES, DIAL, composePhone } from "@/lib/phone";

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
/**
 * Collapse the gateway-centric method list into CUSTOMER-facing choices.
 * Merchants enable acquirers (Paymob, Kashier, …) but a shopper picks "Card",
 * not a gateway — showing "Card / Wallet (Paymob)" AND "Card (Kashier)" (plus
 * one Apple Pay per acquirer) reads as duplicates and leaks plumbing. Keep the
 * FIRST gateway of each group (backend order = merchant priority) as the
 * submitted method; strip its gateway-branded label so the neutral customer
 * label ("Credit / debit card", "Apple Pay") renders instead.
 */
const CARD_GATEWAYS = new Set([
  "paymob", "paymob_card", "kashier", "moyasar", "stripe", "tap", "jt",
]);
function methodGroup(code: string): string {
  const c = code.toLowerCase();
  if (c.includes("apple")) return "apple_pay";
  if (CARD_GATEWAYS.has(c)) return "card";
  return c;
}
function dedupeMethods(methods: MethodOption[]): MethodOption[] {
  const seen = new Set<string>();
  const out: MethodOption[] = [];
  for (const m of methods) {
    const group = methodGroup(m.code);
    if (seen.has(group)) continue;
    seen.add(group);
    // Grouped entries drop the merchant/gateway label ("Card (Kashier)") so
    // methodLabel falls back to the neutral per-code copy.
    if (group === "card") out.push({ ...m, label: undefined, label_ar: undefined });
    else if (group === "apple_pay") out.push({ ...m, label: "Apple Pay", label_ar: "Apple Pay" });
    else out.push(m);
  }
  return out;
}

function normalizePayment(raw: RawPaymentConfig | null | undefined): PaymentConfig {
  if (!raw) return FALLBACK_PAYMENT;
  let methods: MethodOption[] = [];
  if (Array.isArray(raw.payment_methods) && raw.payment_methods.length > 0) {
    methods = raw.payment_methods.filter((m) => m && m.code);
  } else if (Array.isArray(raw.enabled_payment_methods)) {
    methods = raw.enabled_payment_methods.map((code) => ({ code }));
  }
  methods = dedupeMethods(methods);
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
    vodafone_cash: ["Vodafone Cash", "فودافون كاش"],
    cod: ["Cash on delivery", "الدفع عند الاستلام"],
  };
  const entry = labels[code];
  return entry ? (isAr ? entry[1] : entry[0]) : code;
}
const MANUAL_TRANSFER_PROVIDERS: ReadonlySet<string | undefined> = new Set([
  "instapay",
  "vodafone_cash",
]);

function methodSubLabel(code: string, isAr: boolean): string {
  const map: Record<string, [string, string]> = {
    cod: ["Pay cash when it arrives", "ادفع نقدًا عند الاستلام"],
    paymob: ["Visa / Mastercard / wallet", "فيزا / ماستركارد / محفظة"],
    paymob_card: ["Visa / Mastercard", "فيزا / ماستركارد"],
    kashier: ["Visa / Mastercard", "فيزا / ماستركارد"],
    instapay: ["Bank transfer via InstaPay", "تحويل بنكي عبر انستاباي"],
    vodafone_cash: [
      "Transfer from your Vodafone wallet",
      "حوّل من محفظة فودافون كاش",
    ],
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
  // COD is off for this governorate. The address is fine — the generic
  // message sends the shopper to edit an address that was never wrong.
  noRatesCod: { en: "Cash on delivery isn't available for this address. Choose another payment method to continue.", ar: "الدفع عند الاستلام مش متاح للعنوان ده. اختار طريقة دفع تانية عشان تكمّل." },
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
/**
 * The chosen-row marker. A filled disc rather than a bare tick: at a glance
 * down a list, a solid shape reads as "this one" from further away than a
 * hairline check, and it echoes the radio the row is standing in for.
 */
function SelectedDot() {
  return (
    <span
      aria-hidden
      className="ck-selected-dot grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[var(--ck-accent)]"
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--ck-accent-text)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 6 9 17l-5-5" />
      </svg>
    </span>
  );
}

/** Empty counterpart, so every row has a marker slot and nothing shifts. */
function UnselectedDot() {
  return (
    <span
      aria-hidden
      className="h-5 w-5 shrink-0 rounded-full border-[1.5px] border-[var(--ck-frame)]"
    />
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

  // Phone-first identity gate. `identityOpen` is UX only — the SERVER
  // rejects an unverified checkout with 403 phone_verification_required,
  // which re-opens the dialog below. `identityPhone` locks the phone field
  // to the number the customer actually proved.
  const [identityOpen, setIdentityOpen] = useState(false);
  const [identityPhone, setIdentityPhone] = useState<string | null>(null);

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

  // Abandoned-checkout contact enrichment. The single-page checkout has no
  // separate "contact step", so we enrich the abandoned_checkouts row as soon
  // as the shopper has entered reachable contact info (email OR a full-length
  // phone) — debounced so we don't POST on every keystroke. This is what makes
  // a customer who fills the form but never pays recoverable by the merchant's
  // WhatsApp/email flow; without it the row only ever carried line items.
  const composedPhone = composePhone(phoneCc, phone);
  const phoneDigits = composedPhone.replace(/\D/g, "");
  const hasReachableContact =
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()) || phoneDigits.length >= 10;
  useEffect(() => {
    if (!hasReachableContact) return;
    const id = setTimeout(() => {
      void trackCartState({
        email: email.trim() || undefined,
        phone: composedPhone || undefined,
        shipping_address: {
          first_name: firstName,
          last_name: lastName,
          address_line1: line1,
          address_line2: line2 || undefined,
          city: city || stateGov,
          state: stateGov || undefined,
          postal_code: postalCode || undefined,
          country,
          phone: composedPhone || undefined,
        },
      });
    }, 900);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hasReachableContact,
    email,
    composedPhone,
    firstName,
    lastName,
    line1,
    line2,
    city,
    stateGov,
    postalCode,
    country,
  ]);

  // Shipping
  const [rates, setRates] = useState<ShippingRateOption[] | null>(null);
  // Why the backend returned no options. `cod_unavailable` means the
  // merchant switched COD off for this governorate.
  const [noRatesReason, setNoRatesReason] = useState<string | null>(null);
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
  // Stable across retries — see the note in ReviewStep. A fresh UUID per
  // submit defeats the backend's de-dupe, so a retry after the proxy's 15s
  // timeout creates a SECOND order.
  // Lazily initialised ONCE — `useRef(crypto.randomUUID())` would re-evaluate
  // the argument on every render (discarding a UUID per keystroke, and calling
  // it on the SSR path); a ref keeps it out of the render cycle entirely.
  const idempotencyKeyRef = useRef<string>("");
  if (!idempotencyKeyRef.current) idempotencyKeyRef.current = crypto.randomUUID();
  // The exact line items the first attempt submitted, pinned so a retry
  // re-sends them even though the successful-but-timed-out attempt already
  // emptied the server cart. Cleared alongside the idempotency key.
  const submittedLineItemsRef = useRef<
    Array<{ product_id: string; variant_id: string | null; quantity: number }> | null
  >(null);
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
    data: ManualTransferPayload;
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

    // Phone-first identity gate: open the OTP dialog when this store
    // requires verification and this session hasn't proven a phone yet.
    // `required` from the backend is already ANDed with otp_available, so a
    // store whose transport can't deliver a code never shows the gate.
    (async () => {
      try {
        const res = await fetch("/api/identity/status", {
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok) return; // fail open — the server still enforces
        const data = (await res.json().catch(() => ({})))?.data;
        if (data?.verified && typeof data?.phone_masked === "string") {
          // Already proven this session (or a verified returning customer).
          return;
        }
        if (data?.required) setIdentityOpen(true);
      } catch {
        /* fail open — server-side enforcement is the guard */
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
        // Backend CSRF is double-submit (numu_csrf cookie + x-numu-csrf header);
        // without the header this call 403'd and checkout silently fell back to
        // default rates — merchant zone rates never showed.
        const csrf =
          typeof document === "undefined"
            ? ""
            : document.cookie.match(/(?:^|; )numu_csrf=([^;]+)/)?.[1] ?? "";
        const res = await fetch("/api/shipping/options", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(csrf ? { "x-numu-csrf": csrf } : {}),
          },
          body: JSON.stringify({
            governorate_code: governorate,
            cart_subtotal_cents: cartSubtotalCents,
            cart_weight_g: 0,
            cod_requested: codRequested,
          }),
        });
        if (cancelled) return;
        if (!res.ok) {
          setNoRatesReason(null);
          setRates([]);
        } else {
          const body = await res.json();
          setNoRatesReason(
            (body?.data?.unavailable_reason ?? body?.unavailable_reason ?? null) as
              | string
              | null,
          );
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

    // Backstop the abandoned-checkout enrichment right before we attempt
    // payment — if the shopper filled the form and clicked pay faster than the
    // debounced effect fired, this guarantees the row carries their contact so
    // a failed / abandoned payment is still recoverable. Best-effort.
    void trackCartState({
      email: email.trim() || undefined,
      phone: submitPhone || undefined,
      shipping_address: {
        first_name: firstName,
        last_name: lastName,
        address_line1: line1,
        address_line2: line2 || undefined,
        city: city || stateGov,
        state: stateGov || undefined,
        postal_code: postalCode || undefined,
        country,
        phone: submitPhone || undefined,
      },
    });

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
    // Deduped per session + method: a failed submit retried (or back/forward)
    // doesn't double-fire; a genuine method change still emits a fresh event.
    // Carries cart value/currency/contents so the event is usable for
    // value-based optimisation, not just as a step marker.
    if (claim(`api_${getSessionFingerprint()}_${method}`)) {
      void readCartFunnelData().then((cart) =>
        trackFunnel("add_payment_info", { ...cart, payment_method: method }),
      );
    }

    try {
      // Resolve cart line items (server cart is authoritative).
      //
      // Snapshotted for the whole checkout attempt, NOT re-fetched per submit.
      // A first attempt that succeeds server-side but times out at the proxy
      // has already emptied the cart, so re-reading it made the retry post
      // `line_items: []` — rejected by the request schema's `min_length=1`
      // BEFORE the handler runs, which is where the idempotency replay lives.
      // The shopper was then stranded on a "failed" checkout that had in fact
      // created their order. Reusing the snapshot lets the retry reach the
      // replay and land on the real order.
      let line_items = submittedLineItemsRef.current;
      if (!line_items) {
        line_items = [];
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
        // Only pin a non-empty snapshot — an empty read is a transient miss,
        // not a decision to check out with nothing.
        if (line_items.length > 0) submittedLineItemsRef.current = line_items;
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
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKeyRef.current,
        },
        body: JSON.stringify(payload),
      });
      const body = await res.json();
      if (!res.ok) {
        const detail = body?.detail;
        if (detail && typeof detail === "object" && detail.code) {
          // Identity enforcement: the session's phone proof is missing or
          // doesn't match the shipping phone (e.g. the 24h flag expired, or
          // the customer edited the number after verifying). Re-open the
          // OTP dialog instead of stranding them on an opaque error.
          if (detail.code === "phone_verification_required") {
            const msg = String(detail.message || "");
            const [en, ar] = msg.split("|").map((p: string) => p.trim());
            setError(isAr ? ar || en : en || msg);
            setIdentityOpen(true);
            setSubmitting(false);
            return;
          }
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
        // The proxy's own failures ({error:"upstream_timeout", message}) carry
        // a machine token in `error` and the human sentence in `message`.
        // Falling straight through to `body.error` printed the shopper the
        // literal string "upstream_timeout" — on the very screen whose copy is
        // supposed to invite the (now idempotent) retry.
        if (typeof body?.error === "string" && typeof body?.message === "string") {
          setError(
            (isAr && typeof body.message_ar === "string"
              ? body.message_ar
              : body.message) as string,
          );
          setSubmitting(false);
          return;
        }
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
      // Order exists (created, or replayed from the idempotency cache after a
      // timed-out attempt). Retire the key so a later checkout in this session
      // isn't served this order again.
      idempotencyKeyRef.current = crypto.randomUUID();
      submittedLineItemsRef.current = null;
      // The order exists: mute abandoned-checkout tracking so the pending
      // enrichment effect / submit backstop can't re-create this cart as a
      // new abandoned row after the backend has marked it recovered.
      suppressCartTracking();
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
      // Manual rails (InstaPay, Vodafone Cash): no hosted page — we
      // render the transfer instructions inline.
      if (pd && MANUAL_TRANSFER_PROVIDERS.has(pd.provider)) {
        stashPending();
        setInstapayData({
          data: data.payment_data as unknown as ManualTransferPayload,
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
        <h2 className="mb-1 text-lg font-bold text-[var(--ck-fg)]">
          {isAr ? "إتمام الدفع" : "Complete payment"}
        </h2>
        <p className="mb-4 text-sm text-[var(--ck-muted)]">
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
        <ManualTransferInstructions
          data={instapayData.data}
          orderNumber={instapayData.orderNumber}
          locale={locale}
          onContinue={() => {
            clearCheckoutState();
            // The upload step, NOT thank-you: the merchant needs the
            // receipt, and this is the only screen that asks for it.
            router.replace(
              manualResumePath(
                params.domain as string,
                instapayData.data.provider,
                instapayData.orderId,
                instapayData.data.reference_code,
              ),
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
      <h1 className="mb-6 text-xl text-[var(--ck-fg)] [font-family:var(--ck-heading-font)] [font-weight:var(--ck-heading-weight)] [letter-spacing:var(--ck-heading-tracking)]">
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
              <p className="mt-2 text-center text-xs text-[var(--ck-muted)]">
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
                hint={
                  identityPhone && composedPhone === identityPhone
                    ? isAr
                      ? "تم التأكيد عبر واتساب ✓"
                      : "Verified via WhatsApp ✓"
                    : identityPhone
                      ? isAr
                        ? "الرقم اتغيّر — هيتطلب تأكيده تاني عند إتمام الطلب"
                        : "Number changed — it will need verification again at submit"
                      : undefined
                }
              >
                <div className="flex gap-2" dir="ltr">
                  <select
                    aria-label="Country code"
                    value={phoneCc}
                    onChange={(e) => setPhoneCc(e.target.value)}
                    className="w-[5.5rem] shrink-0 rounded-[var(--ck-radius-sm)] border-[length:var(--ck-frame-width)] border-[var(--ck-frame)] bg-white px-2.5 py-2.5 text-sm text-[var(--ck-fg)] outline-none transition-colors focus:border-[var(--ck-ring)] focus:ring-2 focus:ring-[var(--ck-ring)]/25"
                  >
                    {COUNTRIES.map(([code]) => (
                      <option key={code} value={code}>
                        {code} {DIAL[code]}
                      </option>
                    ))}
                  </select>
                  <TextInput
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="100 123 4567"
                    required={stdField(fieldsConfig, "phone").required}
                    aria-invalid={!!fieldErrors.phone}
                    className={`min-w-0 flex-1 ${fieldErrors.phone ? INPUT_INVALID : ""}`}
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
                className="mt-0.5 h-4 w-4 accent-[var(--ck-accent)]"
              />
              <span className="text-xs leading-snug text-[var(--ck-muted)]">{t("waConsent")}</span>
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
              {shippingLoading && <p className="text-sm text-[var(--ck-muted)]">{t("loadingShip")}</p>}
              {!shippingLoading && rates && rates.length === 0 && (
                <p className="text-sm text-red-700">
                  {t(noRatesReason === "cod_unavailable" ? "noRatesCod" : "noRates")}
                </p>
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
                          className="sr-only"
                        />
                        <span className="flex-1">
                          <span className="block font-medium text-[var(--ck-fg)]">{r.name}</span>
                          {(r.estimated_days_min || r.estimated_days_max) && (
                            <span className="text-xs text-[var(--ck-muted)]">
                              {r.estimated_days_min ?? "?"}–{r.estimated_days_max ?? "?"} {t("days")}
                            </span>
                          )}
                        </span>
                        <span className="font-medium text-[var(--ck-fg)]">
                          {r.amount_cents === 0 ? (
                            // A filled chip, not accent-coloured text. Vionne's
                            // gold is 1.99:1 as text on the row tint — pretty
                            // and unreadable. As a fill it carries
                            // `--ck-accent-text`, which the token layer already
                            // picked for contrast (9.2:1 here), and free
                            // shipping gets to look like the small win it is.
                            <span className="inline-block rounded-full bg-[var(--ck-accent)] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[var(--ck-accent-text)]">
                              {t("free")}
                            </span>
                          ) : (
                            formatCents(r.amount_cents, r.currency)
                          )}
                        </span>
                        {/* Marker last, matching the payment rows. A selection
                            marker that moves side between two adjacent lists
                            makes the shopper re-learn the control mid-flow. */}
                        {selectedRate === r.id ? <SelectedDot /> : <UnselectedDot />}
                      </OptionRow>
                    </li>
                  ))}
                </ul>
              )}
            </CheckoutCard>
          )}

          {/* Payment method */}
          <CheckoutCard title={t("payment")}>
            {!payConfig && <p className="text-sm text-[var(--ck-muted)]">{t("loadingPay")}</p>}
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
                      <PaymentMark
                        code={m.code}
                        label={typeof m === "object" ? m.label : undefined}
                        isAr={isAr}
                      />
                      <span className="flex-1">
                        <span className="block font-medium text-[var(--ck-fg)]">
                          {methodLabel(m, isAr)}
                        </span>
                        {methodSubLabel(m.code, isAr) && (
                          <span className="text-xs text-[var(--ck-muted)]">
                            {methodSubLabel(m.code, isAr)}
                          </span>
                        )}
                      </span>
                      {method === m.code ? <SelectedDot /> : <UnselectedDot />}
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
                <p className="mb-2 text-xs font-medium text-[var(--ck-muted)]">{t("savedCards")}</p>
                <ul className="space-y-2.5">
                  <li>
                    <OptionRow selected={savedCardId === null}>
                      <input
                        type="radio"
                        name="saved-card"
                        checked={savedCardId === null}
                        onChange={() => setSavedCardId(null)}
                        className="h-4 w-4 accent-[var(--ck-accent)]"
                      />
                      <span className="text-sm text-[var(--ck-fg)]">{t("newCard")}</span>
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
                          className="h-4 w-4 accent-[var(--ck-accent)]"
                        />
                        <span className="text-sm text-[var(--ck-fg)]">
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

      <IdentityDialog
        open={identityOpen}
        variant="checkout"
        // Dismissible: the shopper may want to read the form first. The
        // server 403s an unverified submit and re-opens this dialog.
        onOpenChange={setIdentityOpen}
        initialPhone={phone}
        onVerified={(result: IdentityVerifiedResult) => {
          setIdentityOpen(false);
          setIdentityPhone(result.phone);
          // The verified E.164 becomes the checkout phone; composePhone
          // passes "+…" numbers through untouched, so cc is irrelevant.
          setPhone(result.phone);
          clearErr("phone");
          // Returning customer: prefill what they'd otherwise retype. The
          // verify response set auth cookies, so /api/customer/me now
          // answers for the rest of the session too.
          const p = result.profile;
          if (p) {
            setFirstName((prev) => prev || p.first_name || "");
            setLastName((prev) => prev || p.last_name || "");
            if (p.email) setEmail((prev) => prev || p.email || "");
          }
        }}
      />
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
            className="mt-0.5 h-4 w-4 accent-[var(--ck-accent)]"
          />
          <span className="text-sm text-[var(--ck-fg)]">
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
