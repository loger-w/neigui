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

  test("M2: heatmap 至少 1 個 tile(anti-empty)(SC-5 case 1+)", async ({ page }) => {
    // 痛點:visible 過寬。fixture 有 5 個 stocks,heatmap 應該有 ≥1 tile
    // (有 sector 對映)。沒這 anti-empty assert,空 svg root 也算 visible。
    await expect(page.locator('[data-testid^="tile-"]').first()).toBeVisible();
  });

  test("M3: leaderboard 點股 → pivot 回 equity mode(SC-5 case 3)", async ({ page }) => {
    // 痛點:cross-mode pivot — leaderboard click stock_id → handleSymbolPick
    // → setMode('equity') + handlePick。沒接好 → 留在 market mode 沒切 page。
    await expect(page.getByTestId(TESTIDS.marketLeaderboard)).toBeVisible();
    // 點 fixture 內任一 lb-row(2330 或其他)
    const firstRow = page.locator('[data-testid^="lb-row-"]').first();
    await firstRow.click();
    // 應該切回 equity mode — heading 出現
    await expect(page.getByRole("heading", { name: "籌碼分析" })).toBeVisible();
  });
});
