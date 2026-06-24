"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { StepIndicator } from "@/components/checkout/StepIndicator";
import {
  BackLink,
  CheckoutCard,
  ErrorBanner,
  Field,
  INPUT_INVALID,
  PrimaryButton,
  Select,
  Textarea,
  TextInput,
} from "@/components/checkout/ui";
import {
  fetchCheckoutFieldsConfig,
  stdField,
  validateCustomFieldValues,
  type CheckoutFieldsConfig,
  type CustomFieldCfg,
} from "@/lib/checkout-fields";
import {
  LocationButton,
  LocationDialog,
  LocationPinnedChip,
  canUseMaps,
  onMapsUnavailable,
  type CapturedLocation,
} from "@/components/checkout/location";
import {
  patchCheckoutState,
  readCheckoutState,
} from "@/lib/checkout-state";
import { EG_GOVERNORATES, governorateLabel } from "@/lib/eg-governorates";
import { getSessionFingerprint } from "@/lib/meta-pixel";

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
  // Merchant-configured checkout fields (standard enable/require toggles +
  // custom fields). Defaults keep the form working before/if the fetch fails.
  const [fieldsConfig, setFieldsConfig] = useState<CheckoutFieldsConfig | null>(
    null,
  );
  const [customValues, setCustomValues] = useState<Record<string, unknown>>({});
  // Inline per-field validation errors (keyed by field id; custom fields use
  // the `cf:<id>` namespace). Shown under each input; cleared on edit.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const clearErr = (key: string) =>
    setFieldErrors((p) => {
      if (!(key in p)) return p;
      const { [key]: _omit, ...rest } = p;
      return rest;
    });

  // Graceful degradation: only offer the picker when a Maps key is present.
  // With no key, loadGoogleMaps() rejects — we hide the button entirely so
  // the customer just types the address (exactly as before Cluster 2).
  const [mapsEnabled, setMapsEnabled] = useState(false);

  const t = (k: keyof typeof T) => (locale === "ar" ? T[k].ar : T[k].en);

  useEffect(() => {
    if (typeof document !== "undefined") {
      setLocale(document.documentElement.lang === "ar" ? "ar" : "en");
    }
    // Offer the picker only with a key AND no prior auth failure this session;
    // hide it live if Maps later reports an auth/referrer failure.
    setMapsEnabled(canUseMaps());
    const unsubMaps = onMapsUnavailable(() => setMapsEnabled(false));

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
    setCustomValues(s.custom_fields || {});

    // Merchant checkout-field config (custom fields + standard toggles).
    void fetchCheckoutFieldsConfig().then(setFieldsConfig);
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

    return () => unsubMaps();
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

    // Config-driven, per-field validation. The hub's checkout-field keys map
    // to this form as: address→line1, area→city, landmark→line2,
    // governorate→state. Phone is our identity source-of-truth, so it's
    // required whenever the config marks it required (default true); email is
    // fully merchant-controlled (enabled + required).
    const errs: Record<string, string> = {};
    const reqMsg = locale === "ar" ? "هذا الحقل مطلوب" : "This field is required";
    const emailCfg = stdField(fieldsConfig, "email");
    const lastCfg = stdField(fieldsConfig, "last_name");
    const areaCfg = stdField(fieldsConfig, "area"); // → city
    const landmarkCfg = stdField(fieldsConfig, "landmark"); // → line2

    if (emailCfg.enabled && emailCfg.required && !email.trim()) {
      errs.email = reqMsg;
    } else if (
      email.trim() &&
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
    ) {
      errs.email = locale === "ar" ? "بريد إلكتروني غير صحيح" : "Enter a valid email";
    }
    if (stdField(fieldsConfig, "phone").required && !phone.trim()) {
      errs.phone = reqMsg;
    }
    if (stdField(fieldsConfig, "first_name").required && !firstName.trim()) {
      errs.first_name = reqMsg;
    }
    if (lastCfg.enabled && lastCfg.required && !lastName.trim()) {
      errs.last_name = reqMsg;
    }
    if (stdField(fieldsConfig, "address").required && !line1.trim()) {
      errs.line1 = reqMsg;
    }
    if (areaCfg.enabled && areaCfg.required && !city.trim()) {
      errs.city = reqMsg;
    }
    if (landmarkCfg.enabled && landmarkCfg.required && !line2.trim()) {
      errs.line2 = reqMsg;
    }
    if (stdField(fieldsConfig, "governorate").required && !state.trim()) {
      errs.state = reqMsg;
    }
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

    // Abandoned-checkout seed — capture contact + cart so the merchant's
    // recovery flow (WhatsApp/email) can reach a customer who drops off after
    // this step. Best-effort; the SPA navigation below keeps this alive.
    void (async () => {
      try {
        const res = await fetch("/api/cart", {
          cache: "no-store",
          credentials: "include",
        });
        if (!res.ok) return;
        const json = await res.json();
        const cart = (json?.data ?? json) as {
          subtotal?: number;
          currency?: string;
          items?: Array<Record<string, unknown>>;
        };
        const items = Array.isArray(cart?.items) ? cart.items : [];
        if (!items.length) return;
        const line_items = items.map((li) => {
          const quantity = Number(li.quantity) || 1;
          const total_price = Number(li.total_price) || 0;
          return {
            product_id: li.product_id,
            product_name: li.product_name ?? li.name,
            variant_id: li.variant_id ?? undefined,
            variant_name: li.variant_name ?? undefined,
            sku: li.sku ?? undefined,
            quantity,
            unit_price:
              Number(li.unit_price) || Math.round(total_price / quantity),
            total_price,
          };
        });
        await fetch("/api/storefront/cart-track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          keepalive: true,
          body: JSON.stringify({
            session_fingerprint: getSessionFingerprint(),
            email,
            phone: phone || undefined,
            shipping_address: {
              first_name: firstName,
              last_name: lastName,
              address_line1: line1,
              address_line2: line2 || undefined,
              city,
              state: state || undefined,
              postal_code: postalCode || undefined,
              country,
              phone: phone || undefined,
            },
            line_items,
            subtotal: Number(cart?.subtotal) || 0,
            currency: cart?.currency || "EGP",
          }),
        });
      } catch {
        /* best-effort — never block checkout on a tracking write */
      }
    })();

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
      custom_fields: customValues,
      // Clear downstream selections that depend on the address.
      selected_shipping_rate_id: null,
      shipping_method: null,
    });
    // `auto=1` lets the shipping step skip itself when there's a single rate.
    router.push(`/${params.domain}/checkout/shipping?auto=1`);
  }

  return (
    <>
      <StepIndicator current="contact" locale={locale} />
      <form onSubmit={submit} className="space-y-5" noValidate>
        <CheckoutCard title={t("contact")} aria-labelledby="contact-heading">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {stdField(fieldsConfig, "email").enabled && (
              <Field label={t("email")} htmlFor="email" error={fieldErrors.email}>
                <TextInput
                  id="email"
                  type="email"
                  required={stdField(fieldsConfig, "email").required}
                  autoComplete="email"
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
            <Field label={t("phone")} htmlFor="phone" error={fieldErrors.phone}>
              <TextInput
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                required={stdField(fieldsConfig, "phone").required}
                aria-invalid={!!fieldErrors.phone}
                className={fieldErrors.phone ? INPUT_INVALID : undefined}
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  clearErr("phone");
                }}
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
            <Field
              label={t("firstName")}
              htmlFor="first_name"
              error={fieldErrors.first_name}
            >
              <TextInput
                id="first_name"
                autoComplete="given-name"
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
              <Field
                label={t("lastName")}
                htmlFor="last_name"
                error={fieldErrors.last_name}
              >
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
            <Field
              label={t("address")}
              htmlFor="line1"
              className="sm:col-span-2"
              error={fieldErrors.line1}
            >
              <TextInput
                id="line1"
                required={stdField(fieldsConfig, "address").required}
                autoComplete="address-line1"
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
              <Field
                label={t("apt")}
                htmlFor="line2"
                className="sm:col-span-2"
                error={fieldErrors.line2}
              >
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
            {stdField(fieldsConfig, "area").enabled && (
              <Field label={t("city")} htmlFor="city" error={fieldErrors.city}>
                <TextInput
                  id="city"
                  required={stdField(fieldsConfig, "area").required}
                  autoComplete="address-level2"
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
            <Field
              label={t("governorate")}
              htmlFor="state"
              error={fieldErrors.state}
            >
              {/* EG ships a governorate dropdown so the server-side shipping
                  resolver gets a canonical zone; other countries free-text. */}
              {country === "EG" ? (
                <Select
                  id="state"
                  autoComplete="address-level1"
                  aria-invalid={!!fieldErrors.state}
                  className={fieldErrors.state ? INPUT_INVALID : undefined}
                  value={state}
                  onChange={(e) => {
                    setState(e.target.value);
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
                  value={state}
                  onChange={(e) => {
                    setState(e.target.value);
                    clearErr("state");
                  }}
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

        {/* Merchant-configured custom checkout fields. */}
        {(fieldsConfig?.custom_fields?.length ?? 0) > 0 && (
          <CheckoutCard
            title={locale === "ar" ? "تفاصيل إضافية" : "Additional details"}
          >
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
                    onChange={(v) => {
                      setCustomValues((prev) => ({ ...prev, [f.id]: v }));
                      clearErr(`cf:${f.id}`);
                    }}
                  />
                ))}
            </div>
          </CheckoutCard>
        )}

        {error && <ErrorBanner>{error}</ErrorBanner>}

        <div className="flex items-center justify-between gap-3">
          <BackLink href={`/${params.domain}/cart`}>{t("backCart")}</BackLink>
          <PrimaryButton type="submit" disabled={submitting}>
            {submitting ? "…" : t("continue")}
          </PrimaryButton>
        </div>
      </form>

      {/* Lazily-mounted only when enabled. The dialog itself defers the
          Google Maps script until it's open. Kept mounted while open even if
          Maps just became unavailable, so a mid-session auth failure shows the
          dialog's clean manual-entry fallback rather than vanishing. */}
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

/** Render one merchant-defined custom field by type. */
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
  const labelWithOpt = field.required
    ? label
    : `${label} (${isAr ? "اختياري" : "optional"})`;
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
