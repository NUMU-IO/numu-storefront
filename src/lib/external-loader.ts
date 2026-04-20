"use client";

/**
 * Load an external BYOT theme bundle from a CDN URL.
 * Returns the module's default export (the theme component tree).
 */
export async function loadExternalTheme(bundleUrl: string): Promise<any> {
  try {
    const module = await import(/* webpackIgnore: true */ bundleUrl);
    return module.default || module;
  } catch (error) {
    console.error(`Failed to load external theme from ${bundleUrl}:`, error);
    throw error;
  }
}

/**
 * Load external CSS for a BYOT theme.
 */
export function loadExternalCSS(cssUrl: string): void {
  if (typeof document === "undefined") return;
  const existing = document.querySelector(`link[href="${cssUrl}"]`);
  if (existing) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = cssUrl;
  link.setAttribute("data-numu-theme", "external");
  document.head.appendChild(link);
}
