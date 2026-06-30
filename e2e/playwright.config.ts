import { defineConfig, devices } from "@playwright/test";

const fakeMode = process.env.FAKE_FINMIND !== "real";

export default defineConfig({
  testDir: "./specs",
  fullyParallel: false, // backend singleton + cache,序列跑較穩
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["html"]] : "list",
  globalSetup: "./helpers/global-setup.ts",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: "python -m uvicorn main:app --port 8000",
      cwd: "../backend",
      env: fakeMode
        ? {
            FAKE_FINMIND: "1",
            FAKE_TODAY: "2026-06-26",
            CHIP_DATA_DIR: "../e2e/.cache",
            FINMIND_TOKEN: "fake",
          }
        : { FAKE_FINMIND: "0" },
      // F4 fix:/api/symbols?search=2 是真實 200 endpoint(/api/symbols/2330 不存在)
      url: "http://127.0.0.1:8000/api/symbols?search=2",
      reuseExistingServer: false, // F6 — 不准 reuse 防撞 dev server
      timeout: 60_000,
    },
    {
      command: "npm run dev -- --host 127.0.0.1",
      cwd: "../frontend",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
