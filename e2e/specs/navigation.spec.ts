/**
 * SC-6 mode 切換 + localStorage 持久化 + N4 三步序列(R2-P2-2)。
 * design.md v6 §3 SC-6。
 */
import { test, expect } from "@playwright/test";
import { TESTIDS, ROLES } from "../helpers/selectors.ts";
import { installFixtureClock } from "../helpers/clock.ts";

test.describe("navigation & persistence", () => {
  test.beforeEach(async ({ page }) => {
    await installFixtureClock(page);
  });

  test("N1: 四 mode toggle active style aria-current(SC-6 case 1)", async ({ page }) => {
    // 痛點:F10 — ModeSwitch 用 aria-current='page' (不是 data-state),
    // 改 attr name 雙端必雙改。本 test 鎖死 attr,refactor 立即抓。
    // feat/daytrade-borrow-fee SC-1:mode 列第 4 顆「券差」納入迴圈。
    await page.goto("/");
    for (const role of [
      ROLES.modeSwitchEquity,
      ROLES.modeSwitchOptions,
      ROLES.modeSwitchMarket,
      ROLES.modeSwitchBorrow,
    ]) {
      const btn = page.getByRole(role.role, { name: role.name });
      await btn.click();
      await expect(btn).toHaveAttribute("aria-current", "page");
    }
  });

  test("N2: reload 後 mode 維持(SC-6 case 2)", async ({ page }) => {
    // 痛點:App.tsx:72-75 useState init reads localStorage('mode')。reload
    // 後 mode 應該維持。沒 persistence = user 每次 refresh 回 equity。
    await page.goto("/");
    await page.getByRole(ROLES.modeSwitchOptions.role, { name: ROLES.modeSwitchOptions.name }).click();
    await page.reload();
    // options-page-v2:首屏 root 改結論列(四卡收進收合層,預設 hidden)
    await expect(page.getByTestId(TESTIDS.optionsConclusion)).toBeVisible();
  });

  test("N3: chip_window_days localStorage roundtrip(SC-6 case 3)", async ({ page }) => {
    // 痛點:F15 — RangeSelector 真實 aria-label `設為 N 日`(不是純 `N 日`)。
    // localStorage key `chip_window_days` 是 App.tsx:83 寫的常數。Reload 後
    // 讀回需 type-correct(int valid range)— App.tsx:25-33 readStoredWindowDays
    // 防 NaN / 越界 fallback。
    await page.goto("/");
    await page.getByRole(ROLES.windowDays10.role, { name: ROLES.windowDays10.name }).click();
    await page.reload();
    const stored = await page.evaluate(() => localStorage.getItem("chip_window_days"));
    expect(stored).toBe("10");
  });

  test("N4: mode 切換時對應 mode 元件實際被 unmount(SC-6 case 4 — R2-P2-2)", async ({ page }) => {
    // 痛點:CLAUDE.md §9 sediment「App.tsx ternary 不能變 hidden div」regression
    // 鎖。三步序列 verify cross-mount 真的解除(`toHaveCount(0)`)。
    // 沒這 test,若有人把 ternary 改 `<div hidden={mode!==X}>` → 雙 page
    // 同時 mount,雙倍 fetch FinMind,sediment 抓出來的歷史 bug 復發。
    await page.goto("/");
    // (1) 確認 default equity 有 mount
    await expect(page.getByTestId(TESTIDS.chipBrokersPanel)).toBeVisible();
    // 切 options → assert chip-brokers unmount
    await page.getByRole(ROLES.modeSwitchOptions.role, { name: ROLES.modeSwitchOptions.name }).click();
    await expect(page.getByTestId(TESTIDS.optionsConclusion)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.chipBrokersPanel)).toHaveCount(0);
    // (2) 切 market → assert options unmount
    await page.getByRole(ROLES.modeSwitchMarket.role, { name: ROLES.modeSwitchMarket.name }).click();
    await expect(page.getByTestId(TESTIDS.marketHeatmap)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.optionsConclusion)).toHaveCount(0);
    // (3) 切 borrow → assert market unmount(feat/daytrade-borrow-fee:4-way
    //     ternary 的新末端分支也要進 unmount 鎖,防 hidden-div 復發)
    await page.getByRole(ROLES.modeSwitchBorrow.role, { name: ROLES.modeSwitchBorrow.name }).click();
    await expect(page.getByTestId(TESTIDS.borrowFeePage)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.marketHeatmap)).toHaveCount(0);
    // (4) 切回 equity → assert borrow unmount
    await page.getByRole(ROLES.modeSwitchEquity.role, { name: ROLES.modeSwitchEquity.name }).click();
    await expect(page.getByTestId(TESTIDS.chipBrokersPanel)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.borrowFeePage)).toHaveCount(0);
  });
});
