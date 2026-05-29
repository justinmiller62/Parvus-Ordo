import { defineConfig, devices } from "@playwright/test";

// E2E layer (Architecture §14, Layer 3). Critical journeys first; multi-tenant
// isolation specs (non-negotiable, per §14) are added when the DB/RLS land.
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // Serialized: stateful wizard tests share one DB + seeded user across viewport
  // projects; running one-at-a-time avoids cross-test races. (Per-test DB
  // isolation via Neon branching is the long-term replacement.)
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  // Mobile-first is a hard requirement: every spec runs on a phone viewport too.
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
