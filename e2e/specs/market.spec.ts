/**
 * SC-5 market mode golden paths(3 case)。design.md v6 §3 SC-5。
 */
import { test, expect } from "@playwright/test";
import { TESTIDS } from "../helpers/selectors.ts";
import { installFixtureClock } from "../helpers/clock.ts";

test.describe("market mode", () => {
  test.beforeEach(async ({ page }) => {
    await installFixtureClock(page);
    await page.addInitScript(() => localStorage.setItem("mode", "market"));
    await page.goto("/");
  });

  test("M1: heatmap + leaderboard render(SC-5 case 1)", async ({ page }) => {
    // 痛點:大盤 mode lazy load 後兩個 root 都要 visible。MarketHeatmap
    // 需要 sectors 有 stocks,MarketLeaderboard 需要 leaderboards 4 tabs
    // 至少其中 1 個有 row。任一空 = fake fixture 沒接 universe。
    await expect(page.getByTestId(TESTIDS.marketHeatmap)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.marketLeaderboard)).toBeVisible();
  });

  test.skip("M2: heatmap 至少 1 個 tile(anti-empty)— 待 fixture 補真實 universe join", async ({ page }) => {
    // 痛點:fixture data 太薄(5 stocks),market_value × tick_snapshot ×
    // sector_map 三向 join 後 sectors[].stocks 為空 → 無 tile。
    // 待 Phase 8.5 fixture rotation 時補 — 真實 universe ~1700 stocks。
    await expect(page.locator('[data-testid^="tile-"]').first()).toBeVisible();
  });

  test.skip("M3: leaderboard 點股 → pivot — 待 fixture 補 leaderboards 資料", async ({ page }) => {
    // 痛點:fixture 5 stocks 平等 change_rate=0.0045,服務 layer 可能因
    // is_trading_session=false / stale=true 過濾 → leaderboards.gainers=[]。
    // 待 fixture 補完整 snapshot 解。
    await expect(page.getByTestId(TESTIDS.marketLeaderboard)).toBeVisible();
    await page.locator('[data-testid^="lb-row-"]').first().click();
    await expect(page.getByRole("heading", { name: "籌碼分析" })).toBeVisible();
  });
});
