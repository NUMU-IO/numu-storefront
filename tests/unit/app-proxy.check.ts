// Run: node --test tests/unit/app-proxy.check.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { pickHeaders, REQUEST_HEADERS, RESPONSE_HEADERS } from "../../src/lib/app-proxy.ts";

test("request: shopper cookies and credentials never reach the app", () => {
  const out = pickHeaders(
    new Headers({
      cookie: "numu_session=x",
      authorization: "Bearer x",
      "x-forwarded-for": "1.2.3.4",
      accept: "text/html",
      "accept-language": "ar",
    }),
    REQUEST_HEADERS,
  );
  assert.deepEqual([...out.keys()].sort(), ["accept", "accept-language"]);
});

test("response: the app cannot set cookies on the store's domain", () => {
  const out = pickHeaders(
    new Headers({
      "set-cookie": "evil=1",
      "content-type": "text/html",
      "content-security-policy": "sandbox allow-scripts",
    }),
    RESPONSE_HEADERS,
  );
  assert.equal(out.get("set-cookie"), null);
  assert.equal(out.get("content-security-policy"), "sandbox allow-scripts");
});
