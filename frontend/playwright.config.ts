import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  timeout: 60000,
  expect: { timeout: 15000 },
  workers: 1,
  use: {
    baseURL: process.env.UI_TEST_URL || "http://localhost:3000",
    browserName: "chromium",
    channel: process.env.UI_TEST_BROWSER_CHANNEL || "chrome",
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
