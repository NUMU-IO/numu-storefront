/**
 * Server-safe conservative HTML sanitizer for merchant-authored rich text.
 *
 * WHERE THIS IS USED
 *   - CMS page bodies   (`/pages/[handle]`)
 *   - Blog article HTML (`/blogs/[blog]/[article]`)
 *   - The built-in `rich_text` theme block (`themes/shared/blocks/RichText`)
 *
 * All three render merchant-controlled HTML through
 * `dangerouslySetInnerHTML`. Without sanitization a merchant (or anyone
 * who can write those fields via a compromised hub session) could store
 * `<script>…</script>`, inline `on*=` handlers, or `javascript:` URLs that
 * execute for every visitor — i.e. stored XSS.
 *
 * WHY A LOCAL STRIP INSTEAD OF A LIBRARY
 *   No allowlist sanitizer (DOMPurify / rehype-sanitize) is currently a
 *   dependency of this app, and pulling one in blindly is out of scope for
 *   this hardening pass. This module is a *conservative* strip that runs in
 *   plain Node (no DOM), so it is safe to call from React Server Components
 *   (the page routes are async RSCs). It mirrors the server-side algorithm
 *   the SDK's `<RichText>` uses, keeping built-in rendering consistent with
 *   BYOT theme rendering.
 *
 * ⚠️ REMAINING RISK / REAL FIX
 *   A regex strip is NOT a full HTML parser. Malformed or deliberately
 *   nested markup (e.g. an unclosed `<script` with no closing tag, mutation
 *   XSS via entity/attribute tricks) can defeat regex sanitizers. The real
 *   fix is a proper allowlist sanitizer that parses the DOM — either adopt
 *   the SDK's `sanitizeHtml`/`<RichText>` (allowlist + DOMParser on the
 *   client) end-to-end, or add `isomorphic-dompurify` and route every
 *   merchant-HTML sink through it. Until then this closes the obvious
 *   `<script>` / `on*=` / `javascript:` vectors.
 */

/** http/https/mailto/tel are the only protocols we allow on href/src. */
const URL_SAFE_PROTOCOLS = /^(https?|mailto|tel):/i;

/** True when a URL is safe to keep on an `href`/`src` attribute. */
export function isSafeUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  // Relative / same-document references are always fine.
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("?")
  ) {
    return true;
  }
  // Anything with a scheme must use an allowed one. This rejects
  // `javascript:`, `data:`, `vbscript:`, etc.
  return URL_SAFE_PROTOCOLS.test(trimmed);
}

/**
 * Conservatively sanitize an HTML string for server-side rendering.
 *
 * Removes:
 *   - `<script>`, `<style>`, `<iframe>`, `<object>`, `<embed>` blocks
 *     (tag + contents),
 *   - void/self-closing `<link>` and `<meta>` tags,
 *   - inline `on*=` event-handler attributes,
 *   - `href`/`src` attributes whose value is not an allowed URL
 *     (drops `javascript:`/`data:`/etc.).
 *
 * Everything else (formatting tags, links, images with safe URLs) is left
 * intact. Idempotent: re-running on already-sanitized HTML is a no-op.
 */
export function sanitizeHtml(input: string | null | undefined): string {
  if (!input) return "";
  let s = input
    .replace(/<script[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style[\s\S]*?<\/style\s*>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe\s*>/gi, "")
    .replace(/<object[\s\S]*?<\/object\s*>/gi, "")
    .replace(/<embed[\s\S]*?<\/embed\s*>/gi, "")
    // Defence for an unclosed `<script`/`<style` (no matching close tag):
    // strip from the opening tag to end-of-input so a dangling opener
    // cannot smuggle raw markup past the block strips above.
    .replace(/<script[\s\S]*$/gi, "")
    .replace(/<style[\s\S]*$/gi, "")
    // Void tags that carry no closing tag.
    .replace(/<link\b[^>]*>/gi, "")
    .replace(/<meta\b[^>]*>/gi, "");
  // Strip inline event handlers: on*="…" / on*='…' / on*=unquoted.
  s = s.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // Strip href/src carrying a disallowed protocol (javascript:, data:, …).
  s = s.replace(
    /\s+(href|src)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi,
    (full, _attr, val) => {
      const cleaned = String(val).replace(/^['"]|['"]$/g, "");
      return isSafeUrl(cleaned) ? full : "";
    },
  );
  return s;
}
