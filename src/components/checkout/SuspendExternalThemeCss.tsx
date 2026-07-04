"use client";

/**
 * SuspendExternalThemeCss — disables the BYOT theme's stylesheet while
 * the PLATFORM-OWNED checkout is on screen, restoring it on unmount.
 *
 * Why: theme bundles ship Tailwind v3 CSS — UNLAYERED, with the v3
 * preflight (`img,video{max-width:100%;height:auto}`, border resets…).
 * The host storefront is Tailwind v4, whose utilities live in cascade
 * LAYERS — and unlayered CSS beats layered CSS regardless of
 * specificity. `loadExternalCSS` appends the theme stylesheet to
 * <head> and soft navigation never removes it, so walking from a theme
 * page into the built-in checkout left the theme's preflight clobbering
 * the checkout's utilities: `height:auto` beat `.h-8` (giant logo),
 * border resets stripped the inputs — the "unstyled checkout" bug.
 *
 * Scope: rendered ONLY by the checkout layout's built-in branch. A
 * theme that explicitly claims checkout (capabilities.checkout) goes
 * through the passthrough branch, keeps its CSS, and never mounts this.
 * Uses the HTMLLinkElement.disabled toggle (not removal) so restoring
 * on unmount is instant — no refetch, no flash on the way back to the
 * themed store.
 */

import { useEffect } from "react";

export function SuspendExternalThemeCss() {
  useEffect(() => {
    const links = Array.from(
      document.querySelectorAll<HTMLLinkElement>(
        'link[rel="stylesheet"][data-numu-theme="external"]',
      ),
    );
    const suspended = links.filter((l) => !l.disabled);
    for (const l of suspended) l.disabled = true;
    return () => {
      for (const l of suspended) l.disabled = false;
    };
  }, []);

  return null;
}
