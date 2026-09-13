/**
 * COD deposit-to-confirm sizing.
 *
 * Mirrors `deposit_due_cents` in the API (src/api/v1/schemas/tenant/settings.py).
 * The server is the only authority on what gets charged — this exists so the
 * customer is shown the same figure before the order is created, and so we
 * don't ask them to pick a deposit gateway for an order that won't need one.
 *
 * Keep the two implementations in step: the rounding rule and the clamp are
 * what make the quote match the charge.
 */

export interface DepositPolicyConfig {
  enabled: boolean;
  mode?: "fixed" | "percent";
  amount_cents?: number;
  percent?: number;
  min_order_cents?: number;
}

export function depositDueCents(
  policy: DepositPolicyConfig | null | undefined,
  totalCents: number,
): number {
  if (!policy?.enabled || totalCents <= 0) return 0;
  if (totalCents < (policy.min_order_cents ?? 0)) return 0;
  const due =
    policy.mode === "percent"
      ? Math.round((totalCents * (policy.percent ?? 50)) / 100)
      : (policy.amount_cents ?? 0);
  return Math.min(due, totalCents);
}
