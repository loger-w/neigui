/**
 * SC-8 no_trading_day frontend half(R3-P0-URL-ROUTING fix:addInitScript +
 * DateField.fill,不靠不存在的 URL param)。design.md v6 §3 SC-8。
 */
import { test, expect } from "@playwright/test";
import { installFixtureClock } from "../helpers/clock.ts";
import { TESTIDS } from "../helpers/selectors.ts";

test("NTD1: options page 選 Sat 日期 → 顯示無交易日", async ({ page }) => {
  // 痛點:Backend Sat date → no_trading_day:true,frontend useOptionsXxx
  // hook 暴露 noTradingDay boolean → OptionsMaxPainCard 顯示「無交易日」。
  // 若 backend 改 flag 名 / 前端 hook 不接 → user 看到空 card 不知道是
  // 「無資料」還是「載入中」(silent UX bug)。
  await installFixtureClock(page);
  await page.addInitScript(() => localStorage.setItem("mode", "options"));
  await page.goto("/");
  // 等 options page mount
  await expect(page.getByTestId(TESTIDS.optionsMaxPainCard)).toBeVisible();
  // 選 2026-06-27 (Sat)
  await page.getByLabel("選擇日期").fill("2026-06-27");
  // 4 cards 之一秀「無交易」訊息(真實前端文案 — banner 顯示
  // `<YYYY-MM-DD> 無交易`)
  await expect(page.getByText("無交易").first()).toBeVisible();
});
