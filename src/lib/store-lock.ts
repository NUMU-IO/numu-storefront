/**
 * Store password gate — shared helpers.
 *
 * The merchant can lock a store pre-launch by setting
 * `store.settings.password_protected = { enabled: true, password_hash }`.
 *
 * ## Why the hash is no longer here
 *
 * This module used to receive `password_hash` from the store payload and
 * compare it locally. That required the API's `/store-by-subdomain` endpoint
 * — which is **public and unauthenticated** — to include the hash, so an
 * unsalted SHA-256 of a merchant-chosen password was readable by anyone who
 * could guess a subdomain, and crackable offline in seconds. The pre-launch
 * gate was therefore public.
 *
 * Now:
 *   1. The visitor POSTs the password to `/api/storefront/unlock`.
 *   2. That route asks the API to verify it (`…/verify-password`), which
 *      compares server-side and answers with a bare boolean.
 *   3. On success the route sets an HttpOnly `numu_store_unlock` cookie
 *      containing an HMAC over the store id, keyed by a secret that only the
 *      storefront server holds.
 *   4. The layout re-derives that HMAC and compares. No secret and no hash
 *      ever reaches the browser, and the cookie is useless on another store.
 *
 * Still a marketing pre-launch gate, not a security boundary — authenticated
 * routes are unaffected and the backend never trusts this cookie.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const UNLOCK_COOKIE = "numu_store_unlock";

export interface PasswordProtection {
  enabled: boolean;
  /** Whether a password is actually set — the API sends this, not the hash. */
  hasPassword: boolean;
}

export function readPasswordProtection(store: any): PasswordProtection | null {
  const cfg = store?.settings?.password_protected;
  if (!cfg || typeof cfg !== "object") return null;
  if (cfg.enabled !== true) return null;
  return {
    enabled: true,
    // `has_password` is the projected field. Fall back to the presence of a
    // legacy `password_hash` so a stale cached payload still gates correctly
    // during the deploy window.
    hasPassword:
      cfg.has_password === true || typeof cfg.password_hash === "string",
  };
}

/**
 * Secret backing the unlock cookie.
 *
 * Reuses `REVALIDATION_SECRET` — already required in production and already
 * server-only (`next start` reads it from the shell, never inlines it). The
 * fallback exists so local dev without the var still functions; it is not a
 * secret and does not need to be, because the gate it protects is a
 * pre-launch curtain rather than an authorization boundary.
 */
function unlockSecret(): string {
  return process.env.REVALIDATION_SECRET || "numu-dev-unlock-secret";
}

/**
 * The cookie value proving this visitor unlocked THIS store.
 *
 * Bound to the store id, so a cookie minted on one store cannot unlock
 * another — which the old scheme also achieved only incidentally, by the
 * hashes differing.
 */
export function unlockToken(storeId: string): string {
  return createHmac("sha256", unlockSecret())
    .update(`store-unlock:${storeId}`)
    .digest("hex");
}

/** Constant-time hex compare, so probing cannot leak a prefix match. */
export function hashesMatch(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export function isUnlocked(
  cookieValue: string | undefined,
  storeId: string | null | undefined,
): boolean {
  if (!cookieValue || !storeId) return false;
  return hashesMatch(cookieValue, unlockToken(storeId));
}
