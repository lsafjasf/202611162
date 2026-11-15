import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.js",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:49231",
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  },
  webServer: {
    command: "npm run dev -- --port 49231 --strictPort",
    url: "http://127.0.0.1:49231",
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
