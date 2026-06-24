/**
 * Merchant-configurable checkout fields — client mirror of the backend
 * `store.settings.checkout_fields` (see NUMU-api core/checkout_fields.py),
 * served via GET /api/storefront/checkout-config.
 *
 * The storefront reads this to:
 *  - show/hide + require standard fields per the merchant's settings, and
 *  - render the merchant's custom fields (and submit them as `custom_fields`,
 *    keyed by field id, in the CheckoutRequest — the backend validates them
 *    against this same config).
 */

export interface StandardFieldCfg {
  enabled: boolean;
  required: boolean;
  /** e.g. "cod_trust" — why phone became required. */
  required_reason?: string;
}

export type CustomFieldType =
  | "text"
  | "textarea"
  | "number"
  | "select"
  | "checkbox";

export interface CustomFieldCfg {
  id: string;
  label: string;
  label_ar?: string | null;
  type: CustomFieldType;
  required?: boolean;
  placeholder?: string | null;
  options?: string[] | null;
  position?: number;
}

export interface CheckoutFieldsConfig {
  standard_fields: Record<string, StandardFieldCfg>;
  custom_fields: CustomFieldCfg[];
}

/** Backend default (core/checkout_fields.py default_config) — used as a safe
 *  fallback so checkout still works if the config fetch fails. */
export const DEFAULT_CHECKOUT_FIELDS: CheckoutFieldsConfig = {
  standard_fields: {
    first_name: { enabled: true, required: true },
    last_name: { enabled: true, required: true },
    phone: { enabled: true, required: true },
    email: { enabled: true, required: false },
    governorate: { enabled: true, required: true },
    area: { enabled: true, required: true },
    address: { enabled: true, required: true },
    landmark: { enabled: true, required: false },
    notes: { enabled: false, required: false },
  },
  custom_fields: [],
};

/** Read a standard field's config with a safe default. */
export function stdField(
  config: CheckoutFieldsConfig | null,
  key: string,
): StandardFieldCfg {
  return (
    config?.standard_fields?.[key] ??
    DEFAULT_CHECKOUT_FIELDS.standard_fields[key] ?? {
      enabled: true,
      required: false,
    }
  );
}

/** Fetch the merchant's checkout-field config. Never throws — falls back to
 *  the built-in defaults so the form always renders. */
export async function fetchCheckoutFieldsConfig(): Promise<CheckoutFieldsConfig> {
  try {
    const res = await fetch("/api/storefront/checkout-config", {
      cache: "no-store",
    });
    if (res.ok) {
      const body = await res.json();
      const data = (body?.data || body) as Partial<CheckoutFieldsConfig>;
      return {
        standard_fields: {
          ...DEFAULT_CHECKOUT_FIELDS.standard_fields,
          ...(data?.standard_fields || {}),
        },
        custom_fields: Array.isArray(data?.custom_fields)
          ? (data.custom_fields as CustomFieldCfg[])
          : [],
      };
    }
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_CHECKOUT_FIELDS;
}

/**
 * Validate submitted custom-field values against the config client-side
 * (the backend re-validates). Returns a list of human error strings.
 * `values` is keyed by field id.
 */
export function validateCustomFieldValues(
  fields: CustomFieldCfg[],
  values: Record<string, unknown>,
  locale: string,
): string[] {
  const errors: string[] = [];
  for (const f of fields) {
    const raw = values[f.id];
    const present = raw !== undefined && raw !== null && String(raw).trim() !== "";
    const label = locale === "ar" && f.label_ar ? f.label_ar : f.label;
    if (f.required && f.type !== "checkbox" && !present) {
      errors.push(
        locale === "ar" ? `${label} مطلوب` : `${label} is required`,
      );
      continue;
    }
    if (f.required && f.type === "checkbox" && raw !== true) {
      errors.push(
        locale === "ar" ? `${label} مطلوب` : `${label} is required`,
      );
      continue;
    }
    if (present && f.type === "number" && Number.isNaN(Number(raw))) {
      errors.push(
        locale === "ar" ? `${label} يجب أن يكون رقمًا` : `${label} must be a number`,
      );
    }
  }
  return errors;
}
