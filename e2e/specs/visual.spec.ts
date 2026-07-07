/**
 * SC-9 visual regression。Linux CI only(Win32 skipped due to font diff)。
 * design.md v6 §3 SC-9 / §5。
 */
import { test, expect } from "@playwright/test";
import { TESTIDS, ROLES } from "../helpers/selectors.ts";
import { installFixtureClock } from "../helpers/clock.ts";
import { VISUAL_THRESHOLD, skipOnWin32 } from "../helpers/visual.ts";

// @visual tag — 平時 npm test grep-invert 排除;只 e2e-update-snapshots workflow
// 跑 update + 生 baseline。第一次 baseline auto-PR merge 後可考慮 npm test 拿掉
// grep-invert 讓 visual diff 進主 CI lane。
test.describe("@visual visual regression", () => {
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
    // 痛點:options-page-v2 四層 layout(結論列/區間地圖/溫度計/收合層)。
    await installFixtureClock(page);
    await page.addInitScript(() => localStorage.setItem("mode", "options"));
    await page.goto("/");
    await page.waitForSelector(`[data-testid="${TESTIDS.optionsThermometer}"]`);
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

// responsive spec SC2/SC3/SC5:mobile / tablet baseline。viewport 用 test.use
// 導航前固定(§9 relayout race)。
test.describe("@visual responsive baselines", () => {
  test.beforeEach(() => {
    skipOnWin32();
  });

  test.describe("mobile 375", () => {
    test.use({ viewport: { width: 375, height: 667 } });

    test("V4: equity mode 2330 mobile 堆疊", async ({ page }) => {
      // 痛點:手機堆疊版面(K 線 45vh + 面板)pixel 鎖住,斷點 class 改壞立見。
      await installFixtureClock(page);
      await page.goto("/");
      await page.getByPlaceholder(/搜尋代號/).fill("2330");
      await page.getByRole("option").first().click();
      await page.waitForSelector(`[data-testid="${TESTIDS.chipBrokersPanel}"]`);
      await expect(page).toHaveScreenshot("equity-2330-mobile.png", { ...VISUAL_THRESHOLD, fullPage: false });
    });

    test("V5: options mode mobile 單欄", async ({ page }) => {
      // 痛點:溫度計收 2 欄 + 區間地圖橫向捲動版面鎖住。
      await installFixtureClock(page);
      await page.addInitScript(() => localStorage.setItem("mode", "options"));
      await page.goto("/");
      await page.waitForSelector(`[data-testid="${TESTIDS.optionsThermometer}"]`);
      await expect(page).toHaveScreenshot("options-top-mobile.png", { ...VISUAL_THRESHOLD, fullPage: false });
    });
  });

  test.describe("tablet 768", () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    test("V6: market mode tablet 堆疊", async ({ page }) => {
      // 痛點:<lg 主 grid 單欄堆疊 + classic 區 mobile 列高版面鎖住。
      await installFixtureClock(page);
      await page.addInitScript(() => localStorage.setItem("mode", "market"));
      await page.goto("/");
      await page.waitForSelector(`[data-testid="${TESTIDS.marketHeatmap}"]`);
      await expect(page).toHaveScreenshot("market-top-tablet.png", { ...VISUAL_THRESHOLD, fullPage: false });
    });
  });
});