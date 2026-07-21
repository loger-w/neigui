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

  test("N1: 五 mode toggle active style aria-current(SC-6 case 1)", async ({ page }) => {
    // 痛點:F10 — ModeSwitch 用 aria-current='page' (不是 data-state),
    // 改 attr name 雙端必雙改。本 test 鎖死 attr,refactor 立即抓。
    // NAV-1(mod/batch-ui-update):第 5 顆「分點反查」納入迴圈。
    await page.goto("/");
    for (const role of [
      ROLES.modeSwitchEquity,
      ROLES.modeSwitchOptions,
      ROLES.modeSwitchMarket,
      ROLES.modeSwitchBorrow,
      ROLES.modeSwitchFlows,
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
    await expect(page.getByTestId(TESTIDS.marketIndexStrength)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.optionsConclusion)).toHaveCount(0);
    // (3) 切 borrow → assert market unmount(feat/daytrade-borrow-fee:4-way
    //     ternary 的新末端分支也要進 unmount 鎖,防 hidden-div 復發)
    await page.getByRole(ROLES.modeSwitchBorrow.role, { name: ROLES.modeSwitchBorrow.name }).click();
    await expect(page.getByTestId(TESTIDS.borrowFeePage)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.marketIndexStrength)).toHaveCount(0);
    // (4) 切 flows(NAV-1 新 mode)→ assert borrow unmount
    await page.getByRole(ROLES.modeSwitchFlows.role, { name: ROLES.modeSwitchFlows.name }).click();
    await expect(page.getByTestId(TESTIDS.brokerFlowsView)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.borrowFeePage)).toHaveCount(0);
    // (5) 切回 equity → assert flows unmount
    await page.getByRole(ROLES.modeSwitchEquity.role, { name: ROLES.modeSwitchEquity.name }).click();
    await expect(page.getByTestId(TESTIDS.chipBrokersPanel)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.brokerFlowsView)).toHaveCount(0);
  });

  test("N5: 返回狀態保留 — flows 已選分點 / market 鑽取展開跨 mode 切換保留(SC-8 mod/batch-ui-polish)", async ({ page }) => {
    // 痛點:mode ternary 真卸載(N4 契約不動)下,返回狀態靠 useSessionState
    // (sessionStorage)還原 — 若有人把 hook 換回 useState,這裡立即紅;
    // 若有人改 ternary 成 hidden div 來「修」這題,N4 紅。兩鎖互補。
    await page.goto("/");
    // flows:選定分點
    await page.getByRole(ROLES.modeSwitchFlows.role, { name: ROLES.modeSwitchFlows.name }).click();
    await page.getByLabel("搜尋分點").fill("富邦");
    await page.getByRole("option", { name: "9600 富邦" }).click();
    await expect(page.getByTestId("broker-flows-buy")).toBeVisible();
    // market:展開族群鑽取
    await page.getByRole(ROLES.modeSwitchMarket.role, { name: ROLES.modeSwitchMarket.name }).click();
    await page.getByTestId("sector-row-btn-半導體業").click();
    await expect(page.getByTestId("sub-row-半導體業-晶圓代工")).toBeVisible();
    // 切回 flows:已選分點還原,雙表直接在(不需重新搜尋)
    await page.getByRole(ROLES.modeSwitchFlows.role, { name: ROLES.modeSwitchFlows.name }).click();
    await expect(page.getByLabel("搜尋分點")).toHaveValue("9600 富邦");
    await expect(page.getByTestId("broker-flows-buy")).toBeVisible();
    // 切回 market:鑽取展開仍在
    await page.getByRole(ROLES.modeSwitchMarket.role, { name: ROLES.modeSwitchMarket.name }).click();
    await expect(page.getByTestId("sub-row-半導體業-晶圓代工")).toBeVisible();
  });

  test("N6: 常用分點 — 星號儲存 → reload 後 chips 仍在 → 一鍵帶入(SC-9 mod/batch-ui-polish)", async ({ page }) => {
    // 痛點:常用清單走 localStorage(跨 session);先清 sessionStorage 再
    // reload,隔離 SC-8 的 selected 還原路徑,確保帶入是 chip 的功勞。
    await page.goto("/");
    await page.getByRole(ROLES.modeSwitchFlows.role, { name: ROLES.modeSwitchFlows.name }).click();
    await page.getByLabel("搜尋分點").fill("富邦");
    await page.getByRole("option", { name: "9600 富邦" }).click();
    await expect(page.getByTestId("broker-flows-buy")).toBeVisible();
    await page.getByLabel("加入常用分點").click();
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();
    const row = page.getByTestId("saved-brokers-row");
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "9600 富邦", exact: true }).click();
    await expect(page.getByTestId("broker-flows-buy")).toBeVisible();
    await expect(page.getByLabel("搜尋分點")).toHaveValue("9600 富邦");
  });
});
