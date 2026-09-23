// Run: node --test tests/unit/durable-tracking-cookies.check.ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { keepTrackingCookies } from "../../src/lib/durable-tracking-cookies.ts";

function run(url: string, cookies: Record<string, string>) {
  const out = new Map<string, { value: string; maxAge?: number }>();
  const u = new URL(url);
  keepTrackingCookies(
    {
      nextUrl: u,
      headers: new Headers({ "x-forwarded-proto": "https" }),
      cookies: { get: (n: string) => (n in cookies ? { value: cookies[n] } : undefined) },
    } as never,
    { cookies: { set: (n: string, v: string, o: { maxAge?: number }) => out.set(n, { value: v, maxAge: o.maxAge }) } } as never,
    u.hostname,
  );
  return out;
}

test("refreshes only cookies the browser already has", () => {
  const out = run("https://vionne.numueg.app/products/x", { numu_sid: "sid-1", _fbp: "fb.1.1.2" });
  assert.deepEqual([...out.keys()].sort(), ["_fbp", "numu_sid"]);
  assert.equal(out.get("numu_sid")?.maxAge, 180 * 24 * 60 * 60);
});

test("takes click ids from the landing URL", () => {
  const ttclid = "E.C.P." + "a".repeat(400);
  const out = run(`https://vionne.numueg.app/?ttclid=${ttclid}&fbclid=IwAR1`, {});
  assert.equal(out.get("ttclid")?.value, ttclid);
  assert.match(out.get("_fbc")?.value ?? "", /^fb\.1\.\d+\.IwAR1$/);
});

test("the same Meta click keeps its first-seen time", () => {
  const out = run("https://vionne.numueg.app/?fbclid=IwAR1", { _fbc: "fb.1.123.IwAR1" });
  assert.equal(out.get("_fbc")?.value, "fb.1.123.IwAR1");
});
