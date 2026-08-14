"use client";

/**
 * Save-cart nudge — the mid-shopping half of the phone-first identity layer.
 *
 * Listens for cart changes (`numu:cart:updated`, the same signal
 * AbandonedCartTracker debounces on), and once the cart crosses the
 * merchant-configured thresholds (items / value, after a delay) offers the
 * "save your cart" dialog. Phone entry alone attaches the number to the
 * abandoned-checkout row (recovery works even if they dismiss at the code
 * step); completing the OTP additionally identifies/logs-in the customer.
 *
 * Mounted globally in [domain]/layout.tsx next to <PromoMounts/>, so every
 * theme — built-in or BYOT — gets it with zero theme changes.
 *
 * Suppression rules:
 *   - /checkout* (the checkout gate owns that surface) and /account.
 *   - already verified / identified this session (identity/status).
 *   - dismissed within the last 7 days (localStorage).
 *   - feature off / OTP unavailable for this store (config).
 */

import { useEffect, useRef, useState } from "react";
import { useParams, usePathname } from "next/navigation";
import { IdentityDialog } from "./IdentityDialog";

const DISMISS_KEY = "numu_savecart_dismissed_at";
const DISMISS_TTL_MS = 7 * 24 * 3600 * 1000;
const SUPPRESSED_ROUTES = ["/checkout", "/account"];

/** Mirrors PromoMounts.normalizeRoute — strip /<domain> and /<locale>. */
const LOCALE_SEGMENT_RE = /^[a-z]{2}$/;
function normalizeRoute(pathname: string | null, domain: string | null): string {
  let path = (pathname || "/").toLowerCase();
  if (domain) {
    const prefix = `/${domain.toLowerCase()}`;
    if (path === prefix) path = "/";
    else if (path.startsWith(`${prefix}/`)) path = path.slice(prefix.length);
  }
  const seg = path.split("/")[1] ?? "";
  if (LOCALE_SEGMENT_RE.test(seg)) {
    path = path.slice(seg.length + 1) || "/";
  }
  return path;
}

interface IdentityConfigBlock {
  require_verification?: boolean;
  nudge_enabled?: boolean;
  nudge_min_items?: number;
  nudge_min_value_cents?: number;
  nudge_delay_seconds?: number;
  otp_available?: boolean;
}

function dismissedRecently(): boolean {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return at > 0 && Date.now() - at < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

export function SaveCartNudge() {
  const pathname = usePathname();
  const params = useParams<{ domain?: string }>();
  const [open, setOpen] = useState(false);
  // null = not yet fetched; false = feature off for this store.
  const configRef = useRef<IdentityConfigBlock | false | null>(null);
  const armedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const route = normalizeRoute(
    pathname,
    typeof params?.domain === "string" ? params.domain : null,
  );
  const suppressed = SUPPRESSED_ROUTES.some(
    (r) => route === r || route.startsWith(`${r}/`),
  );

  useEffect(() => {
    if (suppressed) return;

    const onCartUpdated = () => {
      if (armedRef.current || open) return;
      if (dismissedRecently()) return;
      armedRef.current = true; // one evaluation chain per page lifetime
      void evaluate();
    };

    const evaluate = async () => {
      try {
        // 1. Config (once per mount). sessionStorage-cached across pages.
        if (configRef.current === null) {
          let block: IdentityConfigBlock | null = null;
          try {
            const cached = sessionStorage.getItem("numu_identity_cfg");
            if (cached) block = JSON.parse(cached);
          } catch {
            /* ignore */
          }
          if (!block) {
            const res = await fetch("/api/storefront/checkout-config", {
              cache: "no-store",
              credentials: "include",
            });
            if (!res.ok) {
              configRef.current = false;
              return;
            }
            const json = await res.json().catch(() => ({}));
            block = (json?.data?.identity ?? null) as IdentityConfigBlock | null;
            try {
              sessionStorage.setItem(
                "numu_identity_cfg",
                JSON.stringify(block ?? {}),
              );
            } catch {
              /* ignore */
            }
          }
          configRef.current =
            block && block.nudge_enabled && block.otp_available ? block : false;
        }
        const cfg = configRef.current;
        if (!cfg) return;

        // 2. Already verified/identified? Then there's nothing to capture.
        const statusRes = await fetch("/api/identity/status", {
          cache: "no-store",
          credentials: "include",
        });
        if (statusRes.ok) {
          const status = (await statusRes.json().catch(() => ({})))?.data;
          if (status?.verified) return;
        }

        // 3. Cart thresholds.
        const cartRes = await fetch("/api/cart", {
          cache: "no-store",
          credentials: "include",
        });
        if (!cartRes.ok) return;
        const cart = (await cartRes.json().catch(() => ({})))?.data ?? {};
        const items: Array<{ quantity?: number }> = Array.isArray(cart?.items)
          ? cart.items
          : [];
        const itemCount = items.reduce(
          (n, li) => n + (Number(li?.quantity) || 1),
          0,
        );
        const subtotal = Number(cart?.subtotal ?? 0);
        if (itemCount < (cfg.nudge_min_items ?? 1)) {
          armedRef.current = false; // re-evaluate on the next cart change
          return;
        }
        if (subtotal < (cfg.nudge_min_value_cents ?? 0)) {
          armedRef.current = false;
          return;
        }

        // 4. Delay, then show — unless the shopper navigated to a
        // suppressed route in the meantime (checked again at fire time via
        // the cleanup below).
        const delayMs = Math.max(0, Number(cfg.nudge_delay_seconds ?? 45)) * 1000;
        timerRef.current = setTimeout(() => setOpen(true), delayMs);
      } catch {
        /* never let the nudge break shopping */
      }
    };

    window.addEventListener("numu:cart:updated", onCartUpdated);
    return () => {
      window.removeEventListener("numu:cart:updated", onCartUpdated);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suppressed]);

  if (suppressed) return null;

  return (
    <IdentityDialog
      open={open}
      variant="save-cart"
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          try {
            localStorage.setItem(DISMISS_KEY, String(Date.now()));
          } catch {
            /* ignore */
          }
        }
      }}
      onVerified={() => setOpen(false)}
    />
  );
}
