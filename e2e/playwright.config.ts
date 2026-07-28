import { defineConfig, devices } from "@playwright/test";

const fakeMode = process.env.FAKE_FINMIND !== "real";

// 並行 session 佔用 :8000 / :5173 時可用 NEIGUI_BACKEND_PORT /
// NEIGUI_FRONTEND_PORT 覆寫(mod/bubble-chart-ux-polish 沉澱;預設不變)。
// vite.config.ts 讀同名變數同步 dev server port 與 /api proxy target。
const backendPort = process.env.NEIGUI_BACKEND_PORT ?? "8000";
const frontendPort = process.env.NEIGUI_FRONTEND_PORT ?? "5173";

export default defineConfig({
  testDir: "./specs",
  fullyParallel: false, // backend singleton + cache,序列跑較穩
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["html"]] : "list",
  globalSetup: "./helpers/global-setup.ts",
  use: {
    baseURL: `http://127.0.0.1:${frontendPort}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: [
    {
      command: `python -m uvicorn main:app --port ${backendPort}`,
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
      url: `http://127.0.0.1:${backendPort}/api/symbols?search=2`,
      reuseExistingServer: false, // F6 — 不准 reuse 防撞 dev server
      timeout: 60_000,
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${frontendPort}`,
      cwd: "../frontend",
      env: {
        NEIGUI_BACKEND_PORT: backendPort,
        NEIGUI_FRONTEND_PORT: frontendPort,
      },
      url: `http://127.0.0.1:${frontendPort}`,
      // 自評 BF-2:port 覆寫(常因並行 session 佔用)時禁止 reuse — 半套設定
      // 會 reuse 到「別 session 的 dev server」(proxy 指向真後端)靜默錯接。
      reuseExistingServer:
        !process.env.CI &&
        !process.env.NEIGUI_BACKEND_PORT &&
        !process.env.NEIGUI_FRONTEND_PORT,
      timeout: 60_000,
    },
  ],
});
