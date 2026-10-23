import { defineConfig } from "@playwright/test";

/**
 * End-to-end smoke tests against a running frontend + backend (see README, "Test").
 * E2E_BASE_URL: the frontend (default http://localhost:3000). E2E_CHANNEL: a browser installed on
 * this machine, e.g. "msedge" or "chrome"; without it, Playwright's own Chromium
 * (`npx playwright install chromium`).
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel: process.env.E2E_CHANNEL || undefined,
    trace: "retain-on-failure",
  },
});
