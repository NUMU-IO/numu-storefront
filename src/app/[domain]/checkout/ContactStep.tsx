"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { StepIndicator } from "@/components/checkout/StepIndicator";
import {
  BackLink,
  CheckoutCard,
  ErrorBanner,
  Field,
  PrimaryButton,
  Select,
  TextInput,
} from "@/components/checkout/ui";
import {
  LocationButton,
  LocationDialog,
  LocationPinnedChip,
  hasGoogleMapsKey,
  type CapturedLocation,
} from "@/components/checkout/location";
import {
  patchCheckoutState,
  readCheckoutState,
} from "@/lib/checkout-state";
import { EG_GOVERNORATES, governorateLabel } from "@/lib/eg-governorates";

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

// Bilingual copy local to this step.
const T = {
  contact: { en: "Contact", ar: "بيانات التواصل" },
  email: { en: "Email", ar: "البريد الإلكتروني" },
  phone: { en: "Phone", ar: "رقم الهاتف" },
  waConsent: {
    en: "Send me WhatsApp updates from this store (offers, restocks). Reply STOP anytime to opt out.",
    ar: "ابعتلي تحديثات واتساب من المتجر ده (عروض ووصول منتجات). ابعت STOP في أي وقت للإلغاء.",
  },
  shipTitle: { en: "Shipping address", ar: "عنوان التوصيل" },
  shipDesc: {
    en: "Where should we deliver your order?",
    ar: "فين توصّلك طلبك؟",
  },
  firstName: { en: "First name", ar: "الاسم الأول" },
  lastName: { en: "Last name", ar: "اسم العائلة" },
  address: { en: "Address", ar: "العنوان" },
  apt: { en: "Apartment, suite, etc. (optional)", ar: "شقة، مبنى، إلخ (اختياري)" },
  city: { en: "City", ar: "المدينة" },
  governorate: { en: "State / Governorate", ar: "المحافظة" },
  selectGov: { en: "Select governorate", ar: "اختر المحافظة" },
  postal: { en: "Postal code", ar: "الرمز البريدي" },
  optional: { en: "optional", ar: "اختياري" },
  country: { en: "Country", ar: "الدولة" },
  continue: { en: "Continue to shipping", ar: "متابعة إلى الشحن" },
  backCart: { en: "Back to cart", ar: "العودة للسلة" },
  required: {
    en: "Email, address line 1, city, and country are required.",
    ar: "البريد الإلكتروني والعنوان والمدينة والدولة مطلوبة.",
  },
} as const;

export function ContactStep() {
  const router = useRouter();
  const params = useParams() as { domain: string };
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [line1, setLine1] = useState("");
  const [line2, setLine2] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [country, setCountry] = useState("EG");
  const [whatsappConsent, setWhatsappConsent] = useState(false);
  // Cluster 2 — captured Google-Maps delivery pin (lat/lng/accuracy/source/
  // geocoded address). Threaded into shipping_address on Continue.
  const [captured, setCaptured] = useState<CapturedLocation | null>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locale, setLocale] = useState("en");

  // Graceful degradation: only offer the picker when a Maps key is present.
  // With no key, loadGoogleMaps() rejects — we hide the button entirely so
  // the customer just types the address (exactly as before Cluster 2).
  const [mapsEnabled, setMapsEnabled] = useState(false);

  const t = (k: keyof typeof T) => (locale === "ar" ? T[k].ar : T[k].en);

  useEffect(() => {
    if (typeof document !== "undefined") {
      setLocale(document.documentElement.lang === "ar" ? "ar" : "en");
    }
    setMapsEnabled(hasGoogleMapsKey());

    // Hydrate from sessionStorage so a back-nav doesn't blank the form.
    const s = readCheckoutState();
    setEmail(s.email);
    setPhone(s.phone);
    setFirstName(s.shipping_address?.first_name || "");
    setLastName(s.shipping_address?.last_name || "");
    setLine1(s.shipping_address?.address_line1 || "");
    setLine2(s.shipping_address?.address_line2 || "");
    setCity(s.shipping_address?.city || "");
    setState(s.shipping_address?.state || "");
    setPostalCode(s.shipping_address?.postal_code || "");
    setCountry(s.shipping_address?.country || "EG");
    // Rehydrate a previously-captured pin so the chip + payload survive a
    // back-nav from a later step.
    if (
      s.shipping_address?.latitude != null &&
      s.shipping_address?.longitude != null
    ) {
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

    // Authenticated customer pre-fill — best-effort.
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
        /* anonymous visitor — fine */
      }
    })();
  }, []);

  /**
   * Autofill the address fields from a confirmed map pin. User intent is
   * explicit (they just picked a location), so geocodable fields are
   * overwritten. Mirrors V2's CheckoutPage onConfirm logic.
   */
  function applyCapturedLocation(loc: CapturedLocation) {
    setCaptured(loc);
    // Governorate: prefer the backend-normalized slug (matches the EG
    // dropdown options). Only autofill the dropdown when on EG.
    if (country === "EG" && loc.city_code && loc.city_code !== "Other") {
      setState(loc.city_code);
    } else if (country !== "EG" && loc.city) {
      setState(loc.city);
    }
    // City field: use the geocoded city when present.
    if (loc.city) setCity(loc.city);
    // Address line 1: prefer street, else the formatted address.
    if (loc.street) {
      setLine1(loc.street);
    } else if (loc.formatted_address) {
      setLine1(loc.formatted_address);
    }
    // Address line 2: area/neighborhood when we have it and line2 is empty.
    if (loc.area && !line2) setLine2(loc.area);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email || !line1 || !city || !country) {
      setError(t("required"));
      return;
    }
    setSubmitting(true);

    // Fire-and-forget WhatsApp opt-in (best-effort; never blocks checkout).
    if (whatsappConsent && phone) {
      void fetch("/api/whatsapp/opt-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      }).catch(() => {
        /* best-effort */
      });
    }

    patchCheckoutState({
      email,
      phone,
      shipping_address: {
        first_name: firstName,
        last_name: lastName,
        address_line1: line1,
        address_line2: line2 || null,
        city,
        state: state || null,
        postal_code: postalCode || null,
        country,
        phone: phone || null,
        // Cluster 2 — only persist location fields when a pin was captured.
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
      // Clear downstream selections that depend on the address.
      selected_shipping_rate_id: null,
      shipping_method: null,
    });
    router.push(`/${params.domain}/checkout/shipping`);
  }

  return (
    <>
      <StepIndicator current="contact" locale={locale} />
      <form onSubmit={submit} className="space-y-5" noValidate>
        <CheckoutCard title={t("contact")} aria-labelledby="contact-heading">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("email")} htmlFor="email">
              <TextInput
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label={t("phone")} htmlFor="phone">
              <TextInput
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                dir="ltr"
              />
            </Field>
          </div>
          {/* WhatsApp marketing consent — default unticked (GDPR Recital 47).
              Disabled until a phone is typed. */}
          <label
            htmlFor="wa_consent"
            className="mt-4 flex cursor-pointer select-none items-start gap-2.5"
          >
            <input
              id="wa_consent"
              type="checkbox"
              checked={whatsappConsent}
              disabled={!phone}
              onChange={(e) => setWhatsappConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-gray-900"
            />
            <span className="text-xs leading-snug text-gray-500">
              {t("waConsent")}
            </span>
          </label>
        </CheckoutCard>

        <CheckoutCard
          title={t("shipTitle")}
          description={t("shipDesc")}
          aria-labelledby="ship-heading"
        >
          {/* Cluster 2 — Google-Maps delivery pin. Hidden entirely when no
              Maps key is configured (graceful degradation → manual entry). */}
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
                <LocationButton
                  locale={locale}
                  onClick={() => setLocationOpen(true)}
                />
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={t("firstName")} htmlFor="first_name">
              <TextInput
                id="first_name"
                autoComplete="given-name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </Field>
            <Field label={t("lastName")} htmlFor="last_name">
              <TextInput
                id="last_name"
                autoComplete="family-name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </Field>
            <Field
              label={t("address")}
              htmlFor="line1"
              className="sm:col-span-2"
            >
              <TextInput
                id="line1"
                required
                autoComplete="address-line1"
                value={line1}
                onChange={(e) => setLine1(e.target.value)}
                dir="auto"
              />
            </Field>
            <Field label={t("apt")} htmlFor="line2" className="sm:col-span-2">
              <TextInput
                id="line2"
                autoComplete="address-line2"
                value={line2}
                onChange={(e) => setLine2(e.target.value)}
                dir="auto"
              />
            </Field>
            <Field label={t("city")} htmlFor="city">
              <TextInput
                id="city"
                required
                autoComplete="address-level2"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                dir="auto"
              />
            </Field>
            <Field label={t("governorate")} htmlFor="state">
              {/* EG ships a governorate dropdown so the server-side shipping
                  resolver gets a canonical zone; other countries free-text. */}
              {country === "EG" ? (
                <Select
                  id="state"
                  autoComplete="address-level1"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
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
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                />
              )}
            </Field>
            <Field
              label={`${t("postal")} (${t("optional")})`}
              htmlFor="postal"
            >
              <TextInput
                id="postal"
                autoComplete="postal-code"
                value={postalCode}
                onChange={(e) => setPostalCode(e.target.value)}
                dir="ltr"
              />
            </Field>
            <Field label={t("country")} htmlFor="country">
              <Select
                id="country"
                required
                autoComplete="country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              >
                {COUNTRIES.map(([code, en, ar]) => (
                  <option key={code} value={code}>
                    {locale === "ar" ? ar : en}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </CheckoutCard>

        {error && <ErrorBanner>{error}</ErrorBanner>}

        <div className="flex items-center justify-between gap-3">
          <BackLink href={`/${params.domain}/cart`}>{t("backCart")}</BackLink>
          <PrimaryButton type="submit" disabled={submitting}>
            {submitting ? "…" : t("continue")}
          </PrimaryButton>
        </div>
      </form>

      {/* Lazily-mounted only when enabled. The dialog itself defers the
          Google Maps script until it's open. */}
      {mapsEnabled && (
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
