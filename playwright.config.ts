import { defineConfig, devices } from "@playwright/test";

/**
 * Smoke-test config for the NUMU storefront.
 *
 * The storefront is multi-tenant (the store is resolved from the request host),
 * so the smoke test needs a REAL store URL plus a reachable backend API. Point
 * it at one via SMOKE_STORE_URL (e.g. https://<store>.numueg.app or
 * http://<store>.localhost:3100 in dev). When SMOKE_BASE_URL is unset we boot
 * the app locally with `npm run start` (which requires a prior `npm run build`).
 *
 * NOTE: not wired into CI yet — it needs a live store + API to be meaningful.
 * See tests/smoke.spec.ts.
 */
const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:3100";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Boot the storefront locally unless we're told to hit an already-running one.
  webServer: process.env.SMOKE_BASE_URL
    ? undefined
    : {
        command: "npm run start",
        url: BASE_URL,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
      },
});
