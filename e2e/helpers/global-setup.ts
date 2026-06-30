/**
 * Playwright globalSetup — 防 reuseExistingServer 撞 dev server 真 backend。
 *
 * 痛點(F6 / R2-P0-2):若 user 已跑 `uvicorn main:app --reload --port 8000`
 * 帶真實 FINMIND_TOKEN(CLAUDE.md §1 dev loop),Playwright reuse → 整 e2e
 * suite 燒真 FinMind quota + visual baseline drift。
 *
 * Solution:啟 e2e 前 probe `/api/_meta/mode`,fake-mode 期待但拿 real →
 * throw。同時跑 live-guard.assertLiveCap 強制 SC-11 cap。
 */
import { request } from "@playwright/test";
import { assertLiveCap } from "./live-guard.ts";

export default async function globalSetup(): Promise<void> {
  assertLiveCap(); // R5-P1 — globalSetup 一次跑

  const api = await request.newContext({ baseURL: "http://127.0.0.1:8000" });
  const r = await api.get("/api/_meta/mode").catch(() => null);
  if (!r || !r.ok()) {
    throw new Error(
      "Backend /api/_meta/mode 無回應 — webServer 啟動失敗?檢查 backend log。",
    );
  }
  const body = (await r.json()) as { fake: boolean; fake_today: string };
  const expectFake = process.env.FAKE_FINMIND !== "real";

  if (expectFake && !body.fake) {
    throw new Error(
      "ABORT:偵測到 :8000 是 real-mode backend(你在跑 dev server?)。" +
        "先關掉 dev server 再跑 fake-mode E2E。",
    );
  }
  if (!expectFake && body.fake) {
    throw new Error(
      "ABORT:e2e:live 模式但 backend 在 fake mode — 環境變數設定錯",
    );
  }
}
