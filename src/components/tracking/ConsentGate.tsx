"use client";

/**
 * Gates the browser tracking pixels on the visitor's cookie-consent decision.
 *
 * Wraps `<MetaPixel>` / `<TikTokPixel>` in the store layout. When the merchant
 * has `consent_required` off — every live store today — this renders its
 * children immediately and the behaviour is unchanged. When it's on, children
 * are withheld until the visitor accepts, so no `_fbp` / `_ttp` cookie is ever
 * written without consent.
 *
 * It also publishes the policy to `window.__numu_consent` so the imperative
 * `/track` path can stamp `opt_out` on server-side events. That happens in a
 * layout effect rather than a passive one: `postTrack` can fire from a child's
 * mount effect, and a policy published too late would let the first event of
 * the session out un-flagged.
 */

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import {
  CONSENT_CHANGED_EVENT,
  browserPixelAllowed,
  publishConsentPolicy,
  readVisitorConsent,
  type ConsentDecision,
  type StoreConsentPolicy,
} from "@/lib/consent";

// `useLayoutEffect` warns during SSR; the pixels are client-only anyway, so
// fall back to the passive hook on the server render pass.
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

export function ConsentGate({
  policy,
  children,
}: {
  policy: StoreConsentPolicy;
  children: ReactNode;
}) {
  const [decision, setDecision] = useState<ConsentDecision>(null);

  useIsomorphicLayoutEffect(() => {
    publishConsentPolicy(policy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy.required, policy.granular, policy.hasSurface]);

  useEffect(() => {
    setDecision(readVisitorConsent());
    // Re-read on the banner's decision so the pixel mounts on Accept without
    // a reload, and on `storage` so a decision made in another tab applies
    // here too.
    const sync = () => setDecision(readVisitorConsent());
    window.addEventListener(CONSENT_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CONSENT_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // Server render and first client paint agree: when consent is required the
  // gate starts closed, which is the safe direction — a pixel that mounts for
  // one frame has already written its cookie.
  if (!browserPixelAllowed(policy, decision)) return null;
  return <>{children}</>;
}
