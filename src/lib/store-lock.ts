/**
 * Store password gate — shared helpers.
 *
 * The merchant can lock a store pre-launch by setting:
 *   store.settings.password_protected = {
 *     enabled: true,
 *     password_hash: <sha256 hex of the chosen password>,
 *   }
 *
 * Visitors must POST the matching password to /api/storefront/unlock,
 * which sets an HttpOnly `numu_store_unlock` cookie whose value equals
 * the stored hash. The layout re-checks the cookie on every request:
 * cookie === stored_hash → unlocked.
 *
 * This is a marketing pre-launch gate, not a security boundary —
 * authenticated routes (admin, customer auth) are unaffected and the
 * backend never trusts this cookie.
 */
import { createHash, timingSafeEqual } from "node:crypto";

export const UNLOCK_COOKIE = "numu_store_unlock";

export interface PasswordProtection {
  enabled: boolean;
  password_hash?: string | null;
}

export function readPasswordProtection(store: any): PasswordProtection | null {
  const cfg = store?.settings?.password_protected;
  if (!cfg || typeof cfg !== "object") return null;
  if (cfg.enabled !== true) return null;
  return {
    enabled: true,
    password_hash:
      typeof cfg.password_hash === "string" ? cfg.password_hash : null,
  };
}

export function hashPassword(plain: string): string {
  return createHash("sha256").update(plain, "utf8").digest("hex");
}

/** Constant-time hex compare so probing the unlock endpoint can't
 * leak which characters of the hash matched. */
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
  expectedHash: string | null | undefined,
): boolean {
  if (!cookieValue || !expectedHash) return false;
  return hashesMatch(cookieValue, expectedHash);
}
