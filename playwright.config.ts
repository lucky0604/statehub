import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config — P00 only configures; tests land at P01A.
 */
export default defineConfig({
  testDir: "./apps/web/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "tablet-safari", use: { ...devices["iPad 11"], viewport: { width: 768, height: 1024 } } },
    { name: "mobile-safari", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      // P07A: stub GitHub REST calls in e2e so the suite never hits real
      // api.github.com. The fetch route reads this and injects a stub
      // fetchImpl. Production never sets this.
      STATEHUB_E2E_FETCH_STUB: "1",
      // P07D: 32-byte test key for encrypting provider tokens at rest.
      // Generated once with generateKeyB64(); safe to commit because it
      // only encrypts e2e fixture tokens (which are themselves fake).
      // Real installs generate their own key via gen:integration-key.
      STATEHUB_INTEGRATION_KEY:
        "HSxCoRitm3HevhAi69RWQj3QqvCWXi7gwhPeatjhDgg=",
    },
  },
});
