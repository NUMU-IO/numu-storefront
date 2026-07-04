import { test, expect } from "@playwright/test";

/**
 * Storefront smoke test — asserts a real store page mounts its BYOT theme:
 * the loading skeleton is replaced by real content, and the theme boundary's
 * "Failed to load theme" error UI is NOT shown.
 *
 * Requires a live store + backend API. Set SMOKE_STORE_URL to the store to
 * probe (e.g. https://<store>.numueg.app, or http://<store>.localhost:3100 in
 * dev). Intentionally NOT wired into CI yet — see playwright.config.ts.
 */
const STORE_URL = process.env.SMOKE_STORE_URL || "http://demo.localhost:3100/";

test("store home page mounts a theme", async ({ page }) => {
  await page.goto(STORE_URL, { waitUntil: "domcontentloaded" });

  // The theme boundary renders this exact copy when a bundle fails to load or
  // throws during render — it must never appear on a healthy store.
  await expect(page.getByText("Failed to load theme")).toHaveCount(0);

  // The loading skeleton (StorefrontSkeleton) is rendered with
  // role="status" aria-label="Loading". A mounted theme replaces it, so it
  // should detach within the bundle download + mount window.
  await expect(
    page.locator('[role="status"][aria-label="Loading"]'),
  ).toHaveCount(0, { timeout: 20_000 });

  // A mounted theme paints real chrome — assert a structural landmark
  // (header / main / footer) becomes visible, i.e. the bundle rendered
  // content rather than leaving its container empty.
  await expect(page.locator("header, main, footer").first()).toBeVisible({
    timeout: 20_000,
  });

  // And the body has meaningful content, not just blank / skeleton placeholders.
  await expect(page.locator("body")).not.toBeEmpty();
});
