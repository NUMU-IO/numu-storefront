// Run: node --test tests/unit/track-app.check.ts
//
// The /track/<order_id> page: core's view without the Order Tracking app, the
// app's view with it (TESTS.md TRK-K-01 … K-05), and the two core bugs fixed
// alongside (PHASES.md "Phase A results").
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { build, type Plugin } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { primaryBrand, contrastRatio } from "../../src/lib/brand-tokens.ts";

const STORE_A = "66dba506-a217-45e7-938c-627163cfec50";
const STORE_B = "0b6c1c84-77f2-4f43-9d35-2a8e2f3f9a11";
const ORDER_A = "2b1e7a3c-5d4f-4e6a-9b8c-1d2e3f4a5b6c";
const ORDER_B = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";

// Request headers the stubbed `next/headers` hands the page and api-client.
const requestHeaders: Record<string, string> = {};
(globalThis as { __trkHeaders?: Record<string, string> }).__trkHeaders = requestHeaders;

// `next` has no exports map, so plain Node needs the `.js` file; `next/headers`
// is stubbed because it only works inside a Next request.
const nextStubs: Plugin = {
  name: "next-stubs",
  setup(b) {
    b.onResolve({ filter: /^next\/headers$/ }, () => ({ path: "next-headers", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents:
        "export async function headers() { return new Headers(globalThis.__trkHeaders || {}); }\n" +
        "export async function cookies() { return { get() { return undefined; } }; }",
      loader: "js",
    }));
    b.onResolve({ filter: /^next\/(server|navigation)$/ }, (a) => ({ path: `${a.path}.js`, external: true }));
  },
};

// TSX and `@/` imports need a compile step: bundle with the installed esbuild
// into node_modules/.cache, where bare imports such as `react` still resolve.
async function load(entry: string) {
  const out = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    packages: "external",
    plugins: [nextStubs],
    logLevel: "silent",
  });
  const dir = "node_modules/.cache/track-app-check";
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/${entry.replace(/\W+/g, "_")}.mjs`;
  writeFileSync(file, out.outputFiles[0].text);
  return import(pathToFileURL(file).href);
}

type Answer = (url: URL, init?: RequestInit) => Response | Promise<Response>;
const calls: { url: string; init?: RequestInit }[] = [];
let answer: Answer = () => new Response("{}", { status: 404 });
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  calls.push({ url, init });
  return answer(new URL(url, "https://shop.test"), init);
}) as typeof fetch;

function stub(fn: Answer) {
  calls.length = 0;
  answer = fn;
}

const html = (el: unknown) => renderToStaticMarkup(el as Parameters<typeof renderToStaticMarkup>[0]);
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const page = await load("src/app/[domain]/track/[orderId]/page.tsx");
const app = await load("src/app/[domain]/track/[orderId]/TrackApp.tsx");
const core = await load("src/app/[domain]/track/[orderId]/TrackOrder.tsx");
const { toWhatsAppHref } = await load("src/components/storefront/WhatsAppFloat.tsx");

// ── Fixtures: NUMU-api's recordings (TRK-C-03) ───────────────────────────────
// tests/fixtures/order-tracking/shop_*.json are NUMU-api's own answers
// (tests/fixtures/order_tracking_api/, written by
// tests/unit/test_order_tracking_contract.py), copied unchanged. Their order
// numbers, dates and tracking numbers are made up on each recording, so the
// checks read them from the files; a check that needs a fixed date overrides
// it on top of a recorded answer.

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`../fixtures/order-tracking/${name}.json`, import.meta.url), "utf8"));

/** Out for delivery, with items and the contact button. */
const OUT = fixture("shop_order");
const FAILED = fixture("shop_order_failed");
const DELIVERED = fixture("shop_order_delivered");
const RETURNED = fixture("shop_order_returned");
const CANCELLED = fixture("shop_order_cancelled");
/** `show_items` and `show_contact` off. */
const MINIMAL = fixture("shop_order_minimal");

const GOLD = primaryBrand({ primary_color: "#D4AF37", corner_radius: 12 });
const HEAD = { name: "Vionne", logo_url: null, country: "EG" };

const order = (over: Record<string, unknown> = {}) => ({ ...OUT, ...over });

const view = (o: unknown, ar: boolean) =>
  html(createElement(app.TrackAppView, { order: o, orderId: ORDER_A, ar, store: HEAD, brand: GOLD }));

// ── Bug (a): the host track route did not pass ?store= ───────────────────────

test("the track route scopes the order to the host's store, so a foreign order is a 404", async () => {
  const { GET } = await load("src/app/api/storefront/track/[orderId]/route.ts");
  // NUMU-api's behaviour (order_tracking.py track_order): with ?store= the
  // order must belong to it; without, any store's order is served.
  stub((url) => {
    if (url.pathname.endsWith("/storefront/store-by-subdomain/vionne")) {
      return Response.json({ success: true, data: { id: STORE_A, name: "Vionne" } });
    }
    const m = url.pathname.match(/\/storefront\/track\/([^/]+)$/);
    if (m) {
      const owner = m[1] === ORDER_A ? STORE_A : STORE_B;
      const scope = url.searchParams.get("store");
      if (scope && scope !== owner) return Response.json({ detail: "Order not found" }, { status: 404 });
      return Response.json({ success: true, data: { order_id: m[1] } });
    }
    return new Response("{}", { status: 404 });
  });
  const get = (orderId: string) =>
    GET(
      new Request(`https://vionne.numueg.app/api/storefront/track/${orderId}`, {
        headers: { "x-numu-host": "vionne.numueg.app" },
      }),
      { params: Promise.resolve({ orderId }) },
    );

  assert.equal((await get(ORDER_B)).status, 404, "another store's order must not show on this host");
  assert.equal((await get(ORDER_A)).status, 200, "the host's own order still shows");
  assert.ok(calls.some((c) => c.url.includes(`/storefront/track/${ORDER_A}?store=${STORE_A}`)));
});

// ── Bug (b): STATUS_IDX had no returned / refunded ───────────────────────────

const coreOrder = (status: string) => ({
  order_id: ORDER_A,
  order_number: "1042",
  status,
  payment_status: "paid",
  fulfillment_status: "fulfilled",
  currency: "EGP",
  subtotal: 125000,
  shipping_cost: 0,
  tax_amount: 0,
  discount_amount: 0,
  total: 125000,
  line_items: [],
  timeline: { placed_at: "2026-10-10T09:00:00+00:00", shipped_at: "2026-10-11T09:00:00+00:00" },
  store: { name: "Vionne", logo_url: null },
});

test("core's view: returned and refunded orders no longer show Placed", () => {
  for (const [status, en, ar] of [
    ["returned", "Returned", "مرتجع"],
    ["refunded", "Refunded", "تم استرداد المبلغ"],
  ]) {
    const enView = html(core.orderView(coreOrder(status), false, "vionne"));
    const arView = html(core.orderView(coreOrder(status), true, "vionne"));
    assert.ok(!enView.includes(">Placed<"), `${status} shows Placed`);
    assert.ok(enView.includes(`>${en}<`), `${status} chip`);
    assert.ok(arView.includes(`>${ar}<`), `${status} chip (ar)`);
  }
  // Untouched: an open order still shows its step, a cancelled one its chip.
  const shipped = html(core.orderView(coreOrder("shipped"), false, "vionne"));
  assert.ok(shipped.includes(">Shipped<") && shipped.includes("<ol"));
  const cancelled = html(core.orderView(coreOrder("cancelled"), false, "vionne"));
  assert.ok(cancelled.includes(">Cancelled<") && !cancelled.includes("<ol"));
});

// ── TRK-K-01 / K-02: the page picks the view from installed_apps ─────────────

function storeApi(installed: { slug: string }[]): Answer {
  return (url) => {
    if (url.pathname.endsWith("/storefront/store-by-subdomain/vionne")) {
      return Response.json({
        success: true,
        data: { id: STORE_A, name: "Vionne", logo_url: null, default_language: "ar", country: "EG", installed_apps: installed },
      });
    }
    if (url.pathname.endsWith(`/storefront/theme/${STORE_A}`)) {
      return Response.json({
        success: true,
        data: {
          customization_v3: {
            schema_version: 3,
            theme_id: "modern",
            global_settings: { primary_color: "#D4AF37", corner_radius: 12 },
            templates: {},
            section_groups: {},
          },
        },
      });
    }
    return new Response("{}", { status: 404 });
  };
}

test("K-01: without the app the page renders core's TrackOrder exactly as before", async () => {
  stub(storeApi([{ slug: "back-in-stock" }]));
  const el = await page.default({ params: Promise.resolve({ domain: "vionne", orderId: ORDER_A }) });
  assert.equal(el.type.name, "TrackOrder");
  assert.deepEqual(el.props, { orderId: ORDER_A, domain: "vionne" });
  assert.ok(!calls.some((c) => c.url.includes("order-tracking")), "no request for the app");
});

test("K-02: with the app the page renders the app's view, core's view as its fallback", async () => {
  stub(storeApi([{ slug: "order-tracking" }]));
  const el = await page.default({ params: Promise.resolve({ domain: "vionne", orderId: ORDER_A }) });
  assert.equal(el.type.name, "TrackApp");
  assert.equal(el.props.orderId, ORDER_A);
  assert.equal(el.props.ar, true, "the store's default language");
  assert.deepEqual(el.props.store, { name: "Vionne", logo_url: null, country: "EG" });
  assert.deepEqual(el.props.brand, { fill: "#d4af37", onFill: "#111111", link: "#111111", radius: 12 });
  assert.equal(el.props.fallback.type.name, "TrackOrder");
  assert.deepEqual(el.props.fallback.props, { orderId: ORDER_A, domain: "vionne" });

  requestHeaders["x-numu-locale"] = "en";
  const en = await page.default({ params: Promise.resolve({ domain: "vionne", orderId: ORDER_A }) });
  delete requestHeaders["x-numu-locale"];
  assert.equal(en.props.ar, false, "the visitor's chosen language wins");
});

test("K-02: one request, to the app relay", async () => {
  stub(() => Response.json(OUT));
  const found = await app.loadAppOrder(ORDER_A);
  assert.deepEqual(found, OUT);
  assert.deepEqual(calls.map((c) => c.url), [`/api/apps/order-tracking/orders/${ORDER_A}`]);
  assert.equal(calls[0].init?.cache, "no-store");
});

test("K-03: 404, 5xx, a network error, a bad body or 6 s of silence → core's view", async () => {
  for (const res of [
    () => Response.json(fixture("shop_not_installed"), { status: 404 }),
    () => Response.json(fixture("shop_not_found"), { status: 404 }),
    () => Response.json({ detail: "boom" }, { status: 503 }),
    () => new Response("<html>gateway</html>", { status: 200 }),
    () => Response.json({ status: "teleported", steps: [] }),
    () => {
      throw new TypeError("network");
    },
  ]) {
    stub(res);
    assert.equal(await app.loadAppOrder(ORDER_A), null);
    assert.equal(calls.length, 1);
  }
  const notInstalled = Response.json(fixture("shop_not_installed"), { status: 404 });
  stub(() => notInstalled);
  await app.loadAppOrder(ORDER_A);
  assert.ok(notInstalled.bodyUsed, "an unread body is cancelled, so the browser closes the request");

  stub((_url, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))));
  const started = Date.now();
  assert.equal(await app.loadAppOrder(ORDER_A, 50), null);
  assert.ok(Date.now() - started < 2_000, "gives up at the timeout");
});

test("K-04: a non-UUID order id makes no request at all", async () => {
  stub(() => Response.json(OUT));
  for (const id of ["1042", "../../orders", `${ORDER_A}/retry`, ""]) {
    assert.equal(await app.loadAppOrder(id), null, id);
  }
  assert.equal(calls.length, 0);
});

test("K-04: the relay carries the internal headers and passes status and body through", async () => {
  const { GET, POST } = await load("src/app/api/apps/[slug]/[...path]/route.ts");
  process.env.NUMU_INTERNAL_SERVICE_TOKEN = "internal-test-token";
  requestHeaders["x-real-ip"] = "203.0.113.7";
  stub((url, init) => {
    if (url.pathname.endsWith("/storefront/store-by-subdomain/vionne")) {
      return Response.json({ success: true, data: { id: STORE_A } });
    }
    if (url.pathname.endsWith(`/storefront/store/${STORE_A}/apps/order-tracking/orders/${ORDER_A}/retry`)) {
      assert.equal(init?.method, "POST");
      assert.deepEqual(JSON.parse(String(init?.body)), { day: "2026-10-19", window: "afternoon" });
      return Response.json(fixture("shop_retry_conflict"), { status: 409 });
    }
    if (url.pathname.endsWith(`/storefront/store/${STORE_A}/apps/order-tracking/orders/${ORDER_A}`)) {
      return Response.json(OUT, { status: 200 });
    }
    return Response.json(fixture("shop_not_found"), { status: 404 });
  });
  const req = (path: string, init: RequestInit = {}) =>
    new Request(`https://vionne.numueg.app/api/apps/order-tracking/${path}`, {
      ...init,
      headers: { "x-numu-host": "vionne.numueg.app", ...(init.headers as Record<string, string>) },
    });
  const ctx = (path: string[]) => ({ params: Promise.resolve({ slug: "order-tracking", path }) });

  const ok = await GET(req(`orders/${ORDER_A}`), ctx(["orders", ORDER_A]));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), OUT);
  const upstream = calls.find((c) => c.url.includes("/apps/order-tracking/"));
  const sent = new Headers(upstream?.init?.headers);
  assert.equal(sent.get("x-internal-service-token"), "internal-test-token");
  assert.equal(sent.get("x-forwarded-for"), "203.0.113.7", "each shopper gets their own rate-limit bucket");

  const conflict = await POST(
    req(`orders/${ORDER_A}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ day: "2026-10-19", window: "afternoon" }),
    }),
    ctx(["orders", ORDER_A, "retry"]),
  );
  assert.equal(conflict.status, 409);
  assert.deepEqual(await conflict.json(), fixture("shop_retry_conflict"));

  const missing = await GET(req(`orders/${ORDER_B}`), ctx(["orders", ORDER_B]));
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), fixture("shop_not_found"), "the API's 404 body, unchanged");
  delete requestHeaders["x-real-ip"];
});

// ── TRK-K-05: the contact button ─────────────────────────────────────────────

test("K-05: wa.me as the host's WhatsApp button builds it, else tel:, else none", () => {
  const text = `أهلاً، بسأل عن طلبي رقم ${OUT.order_number}`;
  // NUMU-api sends the merchant's own spelling (here "0101 234 5678").
  for (const raw of [OUT.contact.whatsapp, "201012345678", "01012345678", "+20 101 234 5678", "https://wa.me/201012345678"]) {
    const o = order({ contact: { whatsapp: raw, phone: null } });
    assert.equal(app.contactHref(o, true, "EG"), toWhatsAppHref(raw, text, "EG"), raw);
    assert.equal(app.contactHref(o, true, "EG"), `https://wa.me/201012345678?text=${encodeURIComponent(text)}`);
  }
  assert.equal(app.contactHref(OUT, true, "EG"), `https://wa.me/201012345678?text=${encodeURIComponent(text)}`);
  assert.equal(app.contactHref(order({ contact: { whatsapp: null, phone: OUT.contact.phone } }), true, "EG"), "tel:+20223456789");
  assert.equal(app.contactHref(order({ contact: { whatsapp: null, phone: null } }), true, "EG"), null);
  assert.equal(app.contactHref(MINIMAL, true, "EG"), null);

  const markup = view(OUT, true);
  const anchor = markup.match(/<a[^>]*href="https:\/\/wa\.me[^"]*"[^>]*>/)?.[0] ?? "";
  assert.ok(anchor && !anchor.includes("target="), "opens in the same tab");
  assert.ok(anchor.includes('rel="noreferrer"'), "no order URL in the Referer");
  assert.equal(count(markup, "201012345678"), 1, "the number only inside the link");
  assert.ok(!markup.includes(OUT.contact.whatsapp) && !markup.includes(OUT.contact.phone), "the raw numbers are never shown");
  assert.ok(!view(MINIMAL, true).includes("كلّم المتجر"));
});

// ── The app's view, per DESIGN § 3 / § 6, from each recorded answer ──────────

/** The route line's labels, in order. */
const stepLabels = (markup: string) =>
  [...markup.matchAll(/<span class="mt-2 text-xs font-semibold leading-tight">([^<]*)/g)].map((m) => m[1]);

test("out for delivery, Arabic: RTL, headline, route line, ETA, carrier, area, money", () => {
  const ar = view(OUT, true);
  assert.ok(ar.startsWith('<main dir="rtl" lang="ar"'));
  assert.ok(ar.includes("طلبك خارج للتوصيل النهارده"));
  assert.ok(ar.includes("خلّي موبايلك جنبك، المندوب هيكلّمك."));
  assert.ok(ar.includes(`طلب رقم <bdi dir="ltr">#${OUT.order_number}</bdi>`));
  assert.equal(count(ar, "<li"), OUT.steps.length + OUT.items.length, "five steps and the items");
  assert.deepEqual(stepLabels(ar), ["اتأكد", "المندوب استلمه", "في الطريق", "خارج للتوصيل", "اتسلّم"]);
  assert.equal(count(ar, 'aria-current="step"'), 1);
  assert.match(ar, /<li aria-current="step"[^>]*>(?:(?!<\/li>).)*خارج للتوصيل/);
  assert.ok(ar.includes("start-1/2"), "the connector is inset-inline-start");
  assert.ok(ar.includes("متوقّع يوصلك: النهارده"));
  assert.ok(ar.includes("شركة الشحن: بوسطة"));
  assert.ok(ar.includes(`<bdi dir="ltr" class="font-mono font-semibold">${OUT.tracking_number}</bdi>`));
  assert.ok(ar.includes(`href="${OUT.tracking_url}"`) && ar.includes("تابع على موقع بوسطة"));
  assert.ok(ar.includes('target="_blank" rel="noopener noreferrer"'));
  assert.ok(ar.includes("التوصيل في: <bdi>مدينة نصر</bdi>، <bdi>القاهرة</bdi>"));
  assert.ok(ar.includes(`<bdi>${OUT.items[0].name}</bdi>`));
  assert.ok(ar.includes("<bdi>١٬٢٥٠ ج.م</bdi>"));
  assert.ok(ar.includes(">كلّم المتجر<"));
  assert.ok(ar.includes("background:#d4af37;color:#111111"), "the store's primary, with readable text");
  assert.ok(!/4338ca|indigo/i.test(ar), "never the app's indigo");
});

test("English at the same state", () => {
  const en = view(OUT, false);
  assert.ok(en.startsWith('<main dir="ltr" lang="en"'));
  assert.ok(en.includes("Out for delivery today"));
  assert.ok(en.includes("Track on Bosta"));
  assert.ok(en.includes("Delivering to: <bdi>مدينة نصر</bdi>, <bdi>Cairo</bdi>"), "an Arabic city keeps the line LTR");
  assert.ok(en.includes("EGP 1,250"), "Intl puts a no-break space after the code");
  assert.ok(en.includes(">Contact the store<"));
});

test("ETA lines: between, one day, delayed; none once delivered", () => {
  const transit = order({ status: "in_transit", eta: { min: "2026-10-19", max: "2026-10-21" } });
  assert.ok(view(transit, true).includes("متوقّع يوصلك بين <bdi>الاثنين، ١٩ أكتوبر</bdi> و<bdi>الأربعاء، ٢١ أكتوبر</bdi>"));
  assert.ok(view(transit, false).includes("Expected between <bdi>Mon 19 Oct</bdi> and <bdi>Wed 21 Oct</bdi>"));
  assert.ok(view({ ...transit, eta: { min: "2026-10-21", max: "2026-10-21" } }, true).includes("متوقّع يوصلك يوم <bdi>الأربعاء، ٢١ أكتوبر</bdi>"));
  const late = { ...transit, delayed: true };
  assert.ok(view(late, true).includes("اتأخّر عن ميعاده المتوقّع (<bdi>الأربعاء، ٢١ أكتوبر</bdi>)"));
  assert.ok(view(late, false).includes("Running late; expected by <bdi>Wed 21 Oct</bdi>"));

  // NUMU-api still sends the window once delivered; the page shows the delivery day instead.
  assert.ok(DELIVERED.eta && DELIVERED.delivered_at);
  const day = new Intl.DateTimeFormat("ar-EG", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Cairo" }).format(
    new Date(DELIVERED.delivered_at),
  );
  const d = view(DELIVERED, true);
  assert.ok(d.includes("طلبك اتسلّم") && d.includes(`<bdi>${day}</bdi>`));
  assert.ok(!d.includes("متوقّع يوصلك"));
  assert.match(d, /<li aria-current="step"[^>]*>(?:(?!<\/li>).)*اتسلّم/);
});

test("failed: attempt, Try again only while open, already-sent copy otherwise", () => {
  const open = view(FAILED, true);
  assert.deepEqual(FAILED.retry, { open: true, sent: false });
  assert.ok(open.includes("المندوب ماقدرش يوصّل طلبك"));
  assert.ok(open.includes(`المحاولة رقم ${new Intl.NumberFormat("ar-EG").format(FAILED.attempt)}`));
  assert.ok(open.includes('aria-expanded="false" aria-controls="trk-retry"') && open.includes(">حاول تاني<"));
  assert.deepEqual(stepLabels(open), ["اتأكد", "المندوب استلمه", "في الطريق", "ماتسلّمش", "اتسلّم"]);
  assert.match(open, /<li aria-current="step"[^>]*>(?:(?!<\/li>).)*ماتسلّمش/);
  assert.ok(!open.includes("متوقّع يوصلك"), "no ETA on a failed attempt");

  const sent = view({ ...FAILED, retry: { open: false, sent: true } }, true);
  assert.ok(!sent.includes("حاول تاني"));
  assert.ok(sent.includes('role="status"') && sent.includes("بعتنا طلبك للمتجر من شوية. لو محتاج حاجة كلّم المتجر."));
});

test("returned and cancelled: their own step as the sixth, current, the rest ahead", () => {
  const returned = view(RETURNED, true);
  assert.ok(returned.includes("الطلب رجع للمتجر"));
  assert.equal(RETURNED.steps.length, 6);
  assert.deepEqual(stepLabels(returned), ["اتأكد", "المندوب استلمه", "في الطريق", "خارج للتوصيل", "رجع للمتجر", "اتسلّم"]);
  assert.match(returned, /<li aria-current="step"[^>]*>(?:(?!<\/li>).)*رجع للمتجر/);
  assert.ok(!returned.includes("متوقّع يوصلك") && !returned.includes("حاول تاني"));
  assert.ok(returned.includes(">كلّم المتجر<"));

  const cancelled = view(CANCELLED, false);
  assert.ok(cancelled.includes("This order was cancelled"));
  assert.equal(CANCELLED.steps.length, 6);
  assert.deepEqual(stepLabels(cancelled), ["Confirmed", "Cancelled", "Picked up", "On its way", "Out for delivery", "Delivered"]);
  assert.match(cancelled, /<li aria-current="step"[^>]*>(?:(?!<\/li>).)*Cancelled/);
  assert.equal(count(cancelled, 'aria-current="step"'), 1);
  assert.ok(!cancelled.includes("Carrier:"), "no carrier before shipping");
});

test("items, total and the contact button only when the merchant shows them", () => {
  assert.ok(view(OUT, true).includes("المنتجات"));
  const hidden = view(MINIMAL, true);
  assert.ok(!("items" in MINIMAL) && !("total" in MINIMAL) && !("contact" in MINIMAL));
  assert.ok(!hidden.includes("المنتجات") && !hidden.includes("الإجمالي") && !hidden.includes("كلّم المتجر"));
});

test("every recorded answer renders, with nothing private in it (TRK-S-12)", () => {
  for (const [name, answer] of Object.entries({ OUT, FAILED, DELIVERED, RETURNED, CANCELLED, MINIMAL })) {
    const json = JSON.stringify(answer);
    for (const secret of ["1098433918", "شارع", "@", "street", "description"]) assert.ok(!json.includes(secret), `${name}: ${secret}`);
    for (const ar of [true, false]) {
      const markup = view(answer, ar);
      assert.equal(count(markup, "<h1"), 1, name);
      assert.equal(count(markup, 'aria-current="step"'), 1, name);
    }
  }
});

test("Try again answers, as NUMU-api sends them", () => {
  assert.equal(app.retryOutcome(200, fixture("shop_retry")), "sent");
  assert.equal(app.retryOutcome(409, fixture("shop_retry_conflict")), "already_sent");
  assert.equal(app.retryOutcome(409, fixture("shop_retry_not_failed")), "moved_on");
  assert.equal(app.retryOutcome(422, fixture("shop_retry_bad_day")), "other_day");
  assert.equal(app.retryOutcome(422, fixture("shop_retry_invalid")), "failed", "a bad body is our bug, not the shopper's");
  assert.equal(app.retryOutcome(429, fixture("shop_rate_limited")), "too_many");
  assert.equal(app.retryOutcome(404, fixture("shop_not_installed")), "failed");
  assert.equal(app.retryOutcome(502, { detail: "Upstream unreachable" }), "failed");
  assert.equal(app.retryOutcome(409, null), "failed");
});

test("loading: the frame and store header render at once, busy, with a skeleton", () => {
  const loading = view(undefined, true);
  assert.ok(loading.includes('aria-busy="true"') && loading.includes("min-h-svh"));
  assert.ok(loading.includes(">Vionne<") && loading.includes("بنحمّل طلبك…"));
  assert.ok(!loading.includes("<h1"));
});

test("the Try again form: day and time fieldsets, store-timezone dates, a 200-character note", () => {
  const form = html(
    createElement(app.RetryForm, {
      orderId: ORDER_A,
      ar: true,
      brand: GOLD,
      now: new Date("2026-10-18T21:30:00Z"), // 00:30 on the 19th in Cairo
      onDone: () => {},
    }),
  );
  assert.equal(count(form, "<fieldset"), 2);
  assert.ok(form.includes(">اليوم</legend>") && form.includes(">الوقت</legend>"));
  for (const d of ["2026-10-19", "2026-10-20", "2026-10-21"]) assert.ok(form.includes(`value="${d}"`), d);
  assert.ok(form.includes("النهارده") && form.includes("بكرة") && form.includes("بعد بكرة"));
  assert.match(form, /checked="" value="2026-10-20"/, "tomorrow by default");
  assert.match(form, /checked="" value="afternoon"/, "afternoon by default");
  assert.equal(count(form, 'checked=""'), 2);
  assert.ok(form.includes("الصبح") && form.includes('<bdi dir="ltr">9–12</bdi>') && form.includes("بالليل"));
  assert.ok(form.includes('maxLength="200"') && form.includes('<bdi dir="ltr">0/200</bdi>'));
  assert.ok(form.includes("ملاحظة للمندوب (اختياري)") && form.includes(">ابعت للمتجر<"));
});

test("retry days follow Cairo's calendar, DST and year end included", () => {
  assert.deepEqual(app.retryDays(new Date("2026-10-18T20:59:00Z")), ["2026-10-18", "2026-10-19", "2026-10-20"]);
  assert.deepEqual(app.retryDays(new Date("2026-10-18T21:00:00Z")), ["2026-10-19", "2026-10-20", "2026-10-21"]);
  assert.deepEqual(app.retryDays(new Date("2026-12-31T22:00:00Z")), ["2027-01-01", "2027-01-02", "2027-01-03"]);
});

test("money as DESIGN-FAMILY writes it", () => {
  assert.equal(app.money(125000, "EGP", true), "١٬٢٥٠ ج.م");
  assert.equal(app.money(125000, "EGP", false), "EGP 1,250");
  assert.equal(app.money(125050, "EGP", false), "EGP 1,250.50");
});

// ── TRK-A-03: three real brands ──────────────────────────────────────────────

test("core's lookup: the order-number hint is readable on white (axe: gray-400 was 2.6:1)", () => {
  const source = readFileSync("src/app/[domain]/track/TrackLookup.tsx", "utf8");
  const hint = source.match(/<p className="([^"]*)">\s*\{T\(\s*"It's on your confirmation email/)?.[1] ?? "";
  assert.ok(hint.includes("text-gray-500"), hint);
  assert.ok(contrastRatio("#6a7282", "#ffffff") >= 4.5, "Tailwind 4 gray-500 on white");
});

test("A-03: text on the brand fill reaches 4.5:1 for gold, dark and light brands", () => {
  for (const primary of ["#D4AF37", "#111111", "#FFB300", "#2F6F52", "#F5F5F5"]) {
    const b = primaryBrand({ primary_color: primary });
    assert.ok(contrastRatio(b.fill, b.onFill) >= 4.5, `${primary} → ${b.onFill}`);
    assert.ok(contrastRatio(b.link, "#ffffff") >= 4.5, `${primary} link on white`);
  }
  assert.deepEqual(primaryBrand(undefined), { fill: "#111111", onFill: "#ffffff", link: "#111111", radius: 8 });
  assert.equal(primaryBrand({ radius: 4 }).radius, 4, "themes that name it `radius`");
  assert.equal(primaryBrand({ corner_radius: 99 }).radius, 24);
});
