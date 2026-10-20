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

test("forwards Order Tracking's two shopper routes", () => {
  const order = "2b1e7a3c-5d4f-4e6a-9b8c-1d2e3f4a5b6c";
  assert.equal(
    relayPath(STORE, "order-tracking", ["orders", order]),
    `/storefront/store/${STORE}/apps/order-tracking/orders/${order}`,
  );
  assert.equal(
    relayPath(STORE, "order-tracking", ["orders", order, "retry"]),
    `/storefront/store/${STORE}/apps/order-tracking/orders/${order}/retry`,
  );
  assert.equal(relayPath(STORE, "order-tracking", ["orders", "..", "..", "track"]), null);
});

test("forwards the Reviews app's product reviews, page by page", () => {
  const product = "9c0e7a3c-5d4f-4e6a-9b8c-1d2e3f4a5b6c";
  assert.equal(
    relayPath(STORE, "reviews", ["products", product]),
    `/storefront/store/${STORE}/apps/reviews/products/${product}`,
  );
  assert.equal(
    relayPath(STORE, "reviews", ["products", product, "2"]),
    `/storefront/store/${STORE}/apps/reviews/products/${product}/2`,
  );
});

test("refuses an app that is not on the relay list", () => {
  assert.equal(relayPath(STORE, "product-quiz", ["config"]), null);
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
