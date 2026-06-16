/**
 * Shared client helpers for the host promo surfaces (announcement bar, popup,
 * floating widget, cookie banner). Each surface posts impression/click/dismiss
 * to the proxy and remembers per-visitor dismissal in localStorage.
 */

export function postPromo(
  promotionId: string,
  action: "events" | "dismiss" | "submit",
  body: unknown,
): void {
  void fetch(`/api/storefront/promotions/${promotionId}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}

/** Submit a popup/widget form and return the revealed discount code (if any). */
export async function submitPromoForm(
  promotionId: string,
  body: unknown,
): Promise<{ discount_code?: string | null } | null> {
  try {
    const res = await fetch(
      `/api/storefront/promotions/${promotionId}/submit`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) return null;
    const json = await res.json();
    return (json?.data ?? json ?? null) as {
      discount_code?: string | null;
    } | null;
  } catch {
    return null;
  }
}

const dismissKey = (id: string) => `numu_promo_dismissed_${id}`;

export function isPromoDismissed(promotionId: string): boolean {
  try {
    const v = localStorage.getItem(dismissKey(promotionId));
    if (!v) return false;
    const until = Number(v);
    return !Number.isFinite(until) || until > Date.now();
  } catch {
    return false;
  }
}

export function markPromoDismissed(promotionId: string, days = 30): void {
  try {
    localStorage.setItem(
      dismissKey(promotionId),
      String(Date.now() + days * 864e5),
    );
  } catch {
    /* private mode — ignore */
  }
}

interface BiText {
  ar?: string;
  en?: string;
}

/** Pick a bilingual field from translated_content (AR-first when isAr). */
export function pickBi(
  tx: Record<string, unknown> | undefined,
  field: string,
  isAr: boolean,
): string {
  const f = tx?.[field] as BiText | undefined;
  if (!f) return "";
  return ((isAr ? f.ar ?? f.en : f.en ?? f.ar) ?? "").toString();
}
