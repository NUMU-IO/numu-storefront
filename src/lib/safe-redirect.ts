/**
 * `target` as a same-origin path (`/path?query#hash`), or `fallback` when it
 * could send the visitor to another site.
 *
 * A prefix check is not enough: browsers treat `\` as `/` and drop tabs and
 * newlines, so `/\evil.com` or `/\t/evil.com` pass a "starts with one `/`"
 * test and still navigate to evil.com. Resolving against a throwaway origin
 * and requiring that origin back catches every such spelling; the normalised
 * path is what we return.
 */
export function safeRedirectPath(
  target: string | null | undefined,
  fallback = "/",
): string {
  if (!target || !target.startsWith("/") || target.startsWith("//") || target.includes("\\")) {
    return fallback;
  }
  const base = "http://redirect.invalid";
  try {
    const url = new URL(target, base);
    if (url.origin !== base) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
