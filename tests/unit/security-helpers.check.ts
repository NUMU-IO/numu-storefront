// Run: node --test tests/unit/security-helpers.check.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { safeRedirectPath } from "../../src/lib/safe-redirect.ts";
import { sanitizeHtml } from "../../src/lib/sanitize-html.ts";

test("safeRedirectPath keeps same-origin paths", () => {
  assert.equal(safeRedirectPath("/collections/sale?x=1#top"), "/collections/sale?x=1#top");
  assert.equal(safeRedirectPath("/"), "/");
});

test("safeRedirectPath rejects every off-site spelling", () => {
  for (const bad of [
    null,
    "",
    "https://evil.com",
    "//evil.com",
    "/\\evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "javascript:alert(1)",
    "evil.com",
  ]) {
    assert.equal(safeRedirectPath(bad), "/", String(bad));
  }
});

test("sanitizeHtml closes known regex bypasses", () => {
  for (const payload of [
    "<img/onerror=alert(1) src=x>",
    '<a href="x"onclick="alert(1)">x</a>',
    "<scr<script></script>ipt>alert(1)</script>",
    '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;">',
    '<base href="https://evil.com/">',
    '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>',
    '<form><button formaction="javascript:alert(1)">x</button></form>',
    '<object data="javascript:alert(1)">',
  ]) {
    const out = sanitizeHtml(payload);
    assert.doesNotMatch(out, /on\w+\s*=|<script|<iframe|<base|<svg|<object|javascript:/i, `${payload} -> ${out}`);
  }
});

test("sanitizeHtml leaves ordinary rich text alone", () => {
  const html = '<p>Hi <a href="/sale">sale</a> <img src="https://cdn.x/a.png" alt="a"></p>';
  assert.equal(sanitizeHtml(html), html);
});
