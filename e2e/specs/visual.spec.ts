/**
 * SC-9 visual regression。Linux CI only(Win32 skipped due to font diff)。
 * design.md v6 §3 SC-9 / §5。
 */
import { test, expect } from "@playwright/test";
import { TESTIDS, ROLES } from "../helpers/selectors.ts";
import { installFixtureClock } from "../helpers/clock.ts";
import { VISUAL_THRESHOLD, skipOnWin32 } from "../helpers/visual.ts";

test.describe("visual regression", () => {
  test.beforeEach(() => {
    skipOnWin32();
  });

  test("V1: equity mode 2330 top-of-page", async ({ page }) => {
    // 痛點:整個 equity layout(heading + symbol input + chip panel 雙欄
    // grid)pixel-level 鎖住。改 padding / color token 等視覺 regression
    // 在 PR diff 立刻看到。
    await installFixtureClock(page);
    await page.goto("/");
    await page.getByPlaceholder(/搜尋代號/).fill("2330");
    await page.getByRole("option").first().click();
    await page.waitForSelector(`[data-testid="${TESTIDS.chipBrokersPanel}"]`);
    await expect(page).toHaveScreenshot("equity-2330.png", { ...VISUAL_THRESHOLD, fullPage: false });
  });

  test("V2: options mode top-of-page", async ({ page }) => {
    // 痛點:4 options cards layout grid。
    await installFixtureClock(page);
    await page.addInitScript(() => localStorage.setItem("mode", "options"));
    await page.goto("/");
    await page.waitForSelector(`[data-testid="${TESTIDS.optionsMaxPainCard}"]`);
    await expect(page).toHaveScreenshot("options-top.png", { ...VISUAL_THRESHOLD, fullPage: false });
  });

  test("V3: market mode top-of-page", async ({ page }) => {
    // 痛點:heatmap + leaderboard grid layout。
    await installFixtureClock(page);
    await page.addInitScript(() => localStorage.setItem("mode", "market"));
    await page.goto("/");
    await page.waitForSelector(`[data-testid="${TESTIDS.marketHeatmap}"]`);
    await expect(page).toHaveScreenshot("market-top.png", { ...VISUAL_THRESHOLD, fullPage: false });
  });
});
