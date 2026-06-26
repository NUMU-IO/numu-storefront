"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { StepIndicator } from "@/components/checkout/StepIndicator";
import {
  BackLink,
  CheckoutCard,
  ErrorBanner,
  OptionRow,
  PrimaryButton,
  Select,
  TextInput,
} from "@/components/checkout/ui";
import {
  hasShippingStep,
  patchCheckoutState,
  readCheckoutState,
} from "@/lib/checkout-state";
import { trackFunnel } from "@/lib/meta-pixel";

/**
 * Step 3 — payment method picker.
 *
 * Only displays methods the merchant has enabled (read from
 * /api/storefront/checkout-config). COD picks an extra "deposit gateway"
 * sub-form when the store's deposit policy is active. Picking the method
 * here doesn't commit anything — only the review step posts /api/checkout.
 *
 * The backend config payload shape is settling (Phase 2). We tolerate BOTH:
 *   - legacy: { enabled_payment_methods: string[], cod_deposit_policy }
 *   - new:    { payment_methods:[{code,label,label_ar,requires_deposit}],
 *               cod:{enabled,deposit_required,deposit_gateways[]},
 *               saved_cards_enabled, currency }
 * `normalizeConfig` collapses either into one internal shape, preferring the
 * merchant's own method labels when supplied.
 */

interface MethodOption {
  code: string;
  label?: string;
  label_ar?: string;
  requires_deposit?: boolean;
}

/** Internal, normalized config the component renders from. */
interface CheckoutConfig {
  methods: MethodOption[];
  cod: { enabled: boolean; deposit_gateways: string[] };
  saved_cards_enabled: boolean;
}

/** Raw payload either backend shape can produce. */
interface RawCheckoutConfig {
  enabled_payment_methods?: string[];
  payment_methods?: MethodOption[];
  cod_deposit_policy?: { enabled?: boolean; allowed_gateways?: string[] };
  cod?: {
    enabled?: boolean;
    deposit_required?: boolean;
    deposit_gateways?: string[];
  };
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

const FALLBACK_CONFIG: CheckoutConfig = {
  methods: [{ code: "paymob" }, { code: "cod" }],
  cod: { enabled: false, deposit_gateways: [] },
  saved_cards_enabled: true,
};

/** Collapse either backend payload shape into the internal CheckoutConfig. */
function normalizeConfig(raw: RawCheckoutConfig | null | undefined): CheckoutConfig {
  if (!raw) return FALLBACK_CONFIG;

  // Methods: prefer the rich `payment_methods[{code,label,…}]`; otherwise
  // map the legacy `enabled_payment_methods: string[]`.
  let methods: MethodOption[] = [];
  if (Array.isArray(raw.payment_methods) && raw.payment_methods.length > 0) {
    methods = raw.payment_methods.filter((m) => m && m.code);
  } else if (Array.isArray(raw.enabled_payment_methods)) {
    methods = raw.enabled_payment_methods.map((code) => ({ code }));
  }

  // COD deposit: new `cod:{…}` wins; else fold the legacy
  // `cod_deposit_policy:{enabled,allowed_gateways}`.
  const codEnabled = Boolean(
    raw.cod?.deposit_required ??
      raw.cod?.enabled ??
      raw.cod_deposit_policy?.enabled,
  );
  const depositGateways =
    raw.cod?.deposit_gateways ?? raw.cod_deposit_policy?.allowed_gateways ?? [];

  return {
    methods,
    cod: { enabled: codEnabled, deposit_gateways: depositGateways },
    // Default true so a backend that doesn't yet emit the flag still shows
    // saved cards when the customer has any on file.
    saved_cards_enabled: raw.saved_cards_enabled ?? true,
  };
}

function methodLabel(opt: MethodOption | string, isAr: boolean): string {
  const code = typeof opt === "string" ? opt : opt.code;
  // Merchant-supplied labels take precedence over our built-in map.
  if (typeof opt === "object") {
    const merchant = isAr ? opt.label_ar : opt.label;
    if (merchant) return merchant;
  }
  const labels: Record<string, [string, string]> = {
    paymob: ["Credit / debit card (Paymob)", "بطاقة ائتمان / خصم (Paymob)"],
    paymob_card: ["Credit / debit card (Paymob)", "بطاقة ائتمان / خصم (Paymob)"],
    kashier: ["Credit / debit card (Kashier)", "بطاقة ائتمان / خصم (Kashier)"],
    moyasar: ["Card / mada / Apple Pay (Moyasar)", "بطاقة / مدى / Apple Pay (Moyasar)"],
    fawry: ["Fawry", "فوري"],
    fawaterak: ["Fawaterak", "فواتيرك"],
    instapay: ["InstaPay", "إنستاباي"],
    cod: ["Cash on Delivery", "الدفع عند الاستلام"],
  };
  const entry = labels[code];
  if (!entry) return code;
  return isAr ? entry[1] : entry[0];
}

const T = {
  payment: { en: "Payment", ar: "الدفع" },
  loading: { en: "Loading payment options…", ar: "جارٍ تحميل خيارات الدفع…" },
  none: {
    en: "No payment methods configured for this store.",
    ar: "لا توجد طرق دفع مفعّلة لهذا المتجر.",
  },
  savedCards: { en: "Saved cards", ar: "البطاقات المحفوظة" },
  savedHint: {
    en: "Pay faster with a card on file, or pick \"Enter a new card\".",
    ar: "ادفع أسرع ببطاقة محفوظة، أو اختر «إدخال بطاقة جديدة».",
  },
  newCard: { en: "Enter a new card", ar: "إدخال بطاقة جديدة" },
  codTitle: { en: "COD deposit", ar: "عربون الدفع عند الاستلام" },
  codHint: {
    en: "This store requires a small upfront deposit for COD orders. Pick the gateway to charge:",
    ar: "المتجر ده بيطلب عربون بسيط لطلبات الدفع عند الاستلام. اختر بوابة الدفع:",
  },
  pickGateway: { en: "— pick gateway —", ar: "— اختر بوابة —" },
  pickMethod: { en: "Pick a payment method to continue.", ar: "اختر طريقة دفع للمتابعة." },
  pickDeposit: {
    en: "Pick a gateway for the COD deposit payment.",
    ar: "اختر بوابة دفع للعربون.",
  },
  back: { en: "Back to shipping", ar: "العودة للشحن" },
  review: { en: "Review order", ar: "مراجعة الطلب" },
} as const;

export function PaymentStep() {
  const router = useRouter();
  const params = useParams() as { domain: string };
  const [config, setConfig] = useState<CheckoutConfig | null>(null);
  const [method, setMethod] = useState<string | null>(null);
  const [depositGateway, setDepositGateway] = useState<string | null>(null);
  const [savedCards, setSavedCards] = useState<SavedCard[] | null>(null);
  const [savedCardId, setSavedCardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [locale, setLocale] = useState("en");

  const isAr = locale === "ar";
  const t = (k: keyof typeof T) => (isAr ? T[k].ar : T[k].en);

  useEffect(() => {
    if (typeof document !== "undefined") {
      setLocale(document.documentElement.lang === "ar" ? "ar" : "en");
    }
    const s = readCheckoutState();
    if (!hasShippingStep(s)) {
      router.replace(`/${params.domain}/checkout/shipping`);
      return;
    }
    setMethod(s.payment_method);
    setDepositGateway(s.deposit_gateway);
    setSavedCardId(
      (s as unknown as { saved_payment_method_id?: string | null })
        .saved_payment_method_id || null,
    );

    (async () => {
      let savedCardsEnabled = true;
      try {
        const res = await fetch("/api/storefront/checkout-config", {
          cache: "no-store",
        });
        if (res.ok) {
          const body = await res.json();
          const normalized = normalizeConfig(
            (body?.data || body) as RawCheckoutConfig,
          );
          // If the backend returned no methods at all, keep the
          // last-resort fallback so the buyer is never stranded.
          setConfig(
            normalized.methods.length > 0 ? normalized : FALLBACK_CONFIG,
          );
          savedCardsEnabled = normalized.saved_cards_enabled;
        } else {
          setConfig(FALLBACK_CONFIG);
        }
      } catch {
        setConfig(FALLBACK_CONFIG);
      } finally {
        setLoading(false);
      }

      // Saved cards are only fetched when the store enables them.
      if (!savedCardsEnabled) {
        setSavedCards([]);
        return;
      }

      try {
        const storeRes = await fetch("/api/storefront/store", {
          cache: "no-store",
        }).catch(() => null);
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
        /* swallow — saved cards are optional UX */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!method) {
      setError(t("pickMethod"));
      return;
    }
    const codSelected = method === "cod";
    const depositRequired = codSelected && Boolean(config?.cod.enabled);
    if (depositRequired && !depositGateway) {
      setError(t("pickDeposit"));
      return;
    }
    const savedCardForMethod = savedCards?.find(
      (c) =>
        c.id === savedCardId &&
        (c.gateway === method ||
          (c.gateway === "paymob" && method === "paymob_card")),
    );
    // Meta AddPaymentInfo — fired when the buyer confirms a payment method.
    trackFunnel("add_payment_info", { payment_method: method });
    patchCheckoutState({
      payment_method: method,
      cod_requested: codSelected,
      deposit_gateway: depositRequired ? depositGateway : null,
      ...({
        saved_payment_method_id: savedCardForMethod?.id || null,
      } as unknown as Record<string, never>),
    });
    router.push(`/${params.domain}/checkout/review`);
  }

  const methods = config?.methods || [];
  const showDepositPicker = method === "cod" && Boolean(config?.cod.enabled);
  const savedCardsForMethod = (savedCards || []).filter(
    (c) =>
      method &&
      SAVED_CARD_GATEWAYS.has(method) &&
      (c.gateway === method ||
        (c.gateway === "paymob" && method === "paymob_card")),
  );

  return (
    <>
      <StepIndicator current="payment" locale={locale} />
      <form onSubmit={submit} className="space-y-5">
        <CheckoutCard title={t("payment")}>
          {loading && <p className="text-sm text-gray-500">{t("loading")}</p>}
          {!loading && methods.length === 0 && (
            <p className="text-sm text-red-700">{t("none")}</p>
          )}
          {!loading && methods.length > 0 && (
            <ul className="space-y-2.5">
              {methods.map((m) => (
                <li key={m.code}>
                  <OptionRow
                    htmlFor={`m-${m.code}`}
                    selected={method === m.code}
                  >
                    <input
                      id={`m-${m.code}`}
                      type="radio"
                      name="payment"
                      checked={method === m.code}
                      onChange={() => setMethod(m.code)}
                      className="h-4 w-4 accent-gray-900"
                    />
                    <span className="font-medium text-gray-900">
                      {methodLabel(m, isAr)}
                    </span>
                  </OptionRow>
                </li>
              ))}
            </ul>
          )}
        </CheckoutCard>

        {savedCardsForMethod.length > 0 && (
          <CheckoutCard title={t("savedCards")} description={t("savedHint")}>
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
              {savedCardsForMethod.map((c) => (
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
          </CheckoutCard>
        )}

        {showDepositPicker && (
          <CheckoutCard title={t("codTitle")} description={t("codHint")}>
            <Select
              required
              value={depositGateway || ""}
              onChange={(e) => setDepositGateway(e.target.value)}
              className="max-w-xs"
            >
              <option value="">{t("pickGateway")}</option>
              {(config?.cod.deposit_gateways || []).map((g) => (
                <option key={g} value={g}>
                  {methodLabel(g, isAr)}
                </option>
              ))}
            </Select>
          </CheckoutCard>
        )}

        <GiftCardSection locale={locale} />

        {error && <ErrorBanner>{error}</ErrorBanner>}

        <div className="flex items-center justify-between gap-3">
          <BackLink href={`/${params.domain}/checkout/shipping`}>
            {t("back")}
          </BackLink>
          <PrimaryButton type="submit">{t("review")}</PrimaryButton>
        </div>
      </form>
    </>
  );
}

/**
 * Phase 8.3 — gift card tender input. The customer pastes a code, we hit
 * the public balance check, and on success stash the code in checkout
 * state. ReviewStep forwards them as `gift_card_codes`.
 */
function GiftCardSection({ locale }: { locale: string }) {
  const isAr = locale === "ar";
  const [codes, setCodes] = useState<string[]>(
    () => readCheckoutState().gift_card_codes || [],
  );
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<
    Array<{ code: string; last_four: string; balance_cents: number; currency: string }>
  >([]);

  const G = {
    title: { en: "Gift card", ar: "بطاقة هدايا" },
    hint: {
      en: "Apply a gift card to reduce what your payment method is charged. Stack up to 5 cards.",
      ar: "استخدم بطاقة هدايا لتقليل المبلغ المدفوع. يمكنك إضافة حتى 5 بطاقات.",
    },
    apply: { en: "Apply", ar: "تطبيق" },
    checking: { en: "Checking…", ar: "جارٍ التحقق…" },
    dup: { en: "That code is already added.", ar: "الكود ده مضاف بالفعل." },
    max: {
      en: "You can apply up to 5 gift cards per order.",
      ar: "يمكنك إضافة حتى 5 بطاقات للطلب الواحد.",
    },
    invalid: {
      en: "That gift card isn't valid or has been used up.",
      ar: "بطاقة الهدايا دي غير صالحة أو تم استخدامها بالكامل.",
    },
    available: { en: "available", ar: "متاح" },
    remove: { en: "Remove", ar: "إزالة" },
  };
  const g = (k: keyof typeof G) => (isAr ? G[k].ar : G[k].en);

  async function add() {
    const trimmed = input.trim();
    if (!trimmed) return;
    if (codes.includes(trimmed)) {
      setError(g("dup"));
      return;
    }
    if (codes.length >= 5) {
      setError(g("max"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/gift-cards/${encodeURIComponent(trimmed)}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError(
          res.status === 404 ? g("invalid") : `Couldn't check the card (HTTP ${res.status}).`,
        );
        return;
      }
      const json = await res.json();
      const data = json?.data;
      if (!data) {
        setError("Unexpected response from the server.");
        return;
      }
      const next = [...codes, trimmed];
      setCodes(next);
      patchCheckoutState({ gift_card_codes: next });
      setApplied((a) => [
        ...a,
        {
          code: trimmed,
          last_four: data.last_four,
          balance_cents: data.current_balance_cents,
          currency: data.currency,
        },
      ]);
      setInput("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check the card.");
    } finally {
      setBusy(false);
    }
  }

  function remove(code: string) {
    const next = codes.filter((c) => c !== code);
    setCodes(next);
    patchCheckoutState({ gift_card_codes: next });
    setApplied((a) => a.filter((x) => x.code !== code));
  }

  return (
    <CheckoutCard title={g("title")} description={g("hint")}>
      <div className="flex gap-2">
        <TextInput
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="GC-XXXX-XXXX-XXXX-XXXX"
          className="flex-1 font-mono"
          aria-label={g("title")}
          disabled={busy}
          dir="ltr"
        />
        <PrimaryButton
          type="button"
          onClick={add}
          disabled={busy || !input.trim()}
          className="px-4"
        >
          {busy ? g("checking") : g("apply")}
        </PrimaryButton>
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {applied.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {applied.map((a) => (
            <li
              key={a.code}
              className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2"
            >
              <span dir="ltr">
                •••{a.last_four} —{" "}
                <span className="font-medium">
                  {(a.balance_cents / 100).toFixed(2)} {a.currency}
                </span>{" "}
                {g("available")}
              </span>
              <button
                type="button"
                onClick={() => remove(a.code)}
                className="text-xs text-gray-500 hover:text-red-700"
                aria-label={`${g("remove")} ${a.last_four}`}
              >
                {g("remove")}
              </button>
            </li>
          ))}
        </ul>
      )}
    </CheckoutCard>
  );
}
