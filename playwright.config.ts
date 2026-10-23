import { defineConfig, devices } from "@playwright/test";

// اختبارات الواجهة تعمل على خادم قيد التشغيل (npm run build && npm start) متصل بقاعدة تطوير/اختبار، لا الإنتاج.
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    locale: "ar-IQ",
    timezoneId: "Asia/Baghdad",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 860 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
