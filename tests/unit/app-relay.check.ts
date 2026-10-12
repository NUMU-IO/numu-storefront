// Run: node --test tests/unit/app-relay.check.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { formReturnTo, relayPath } from "../../src/lib/app-relay.ts";

const STORE = "66dba506-a217-45e7-938c-627163cfec50";
const FORM = "application/x-www-form-urlencoded";

test("forwards an app's routes to its NUMU-api storefront path", () => {
  assert.equal(relayPath(STORE, "back-in-stock", ["config"]), `/storefront/store/${STORE}/apps/back-in-stock/config`);
  assert.equal(relayPath(STORE, "back-in-stock", ["subscribe"]), `/storefront/store/${STORE}/apps/back-in-stock/subscribe`);
  assert.equal(
    relayPath(STORE, "back-in-stock", ["unsubscribe", "Zx_9-aB3cD4eF5gH6iJ7kL"]),
    `/storefront/store/${STORE}/apps/back-in-stock/unsubscribe/Zx_9-aB3cD4eF5gH6iJ7kL`,
  );
});

test("refuses an app that is not on the relay list", () => {
  assert.equal(relayPath(STORE, "reviews", ["config"]), null);
  assert.equal(relayPath(STORE, "", ["config"]), null);
});

test("refuses paths that could leave the app's routes", () => {
  for (const path of [[], [".."], ["..", "..", "orders"], ["config", "."], ["a/b"], ["a%2Fb"], ["x?y=1"], ["x".repeat(129)]]) {
    assert.equal(relayPath(STORE, "back-in-stock", path), null, JSON.stringify(path));
  }
});

test("the no-script unsubscribe form goes back to the page", () => {
  assert.equal(formReturnTo("back-in-stock", ["unsubscribe", "tok"], FORM, "", true), "/unsubscribe/back-in-stock/tok?done=1");
  assert.equal(formReturnTo("back-in-stock", ["unsubscribe", "tok"], `${FORM}; charset=UTF-8`, "", false), "/unsubscribe/back-in-stock/tok");
});

test("a mail client's one-click POST and the SDK's JSON get the API's answer", () => {
  assert.equal(formReturnTo("back-in-stock", ["unsubscribe", "tok"], FORM, "List-Unsubscribe=One-Click", true), null);
  assert.equal(formReturnTo("back-in-stock", ["unsubscribe", "tok"], "application/json", "{}", true), null);
  assert.equal(formReturnTo("back-in-stock", ["subscribe"], FORM, "", true), null);
});
