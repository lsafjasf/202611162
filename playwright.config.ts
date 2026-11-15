import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: "http://127.0.0.1:19000",
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 960 } }
    }
  ],
  webServer: {
    command: "npm run dev -- --port 19000",
    url: "http://127.0.0.1:19000",
    reuseExistingServer: false,
    timeout: 120_000
  }
});
