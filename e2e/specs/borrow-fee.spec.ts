/**
 * 券差 mode(feat/daytrade-borrow-fee)— BF# spec。
 * FAKE fixture:backend/tests_e2e/fixtures/borrow_fee/(TWSE 202606 + TPEx 當月),
 * 日期對齊 FAKE_TODAY=2026-06-26;happy path 當日有料 → 無 NTD 註記。
 * NTD / 回退 / partial 態由 backend pytest + vitest 覆蓋(brainstorm SC-4
 * amendment:單一 webServer fixture 無法同時呈現兩態)。
 */
import { test, expect } from "@playwright/test";
import { TESTIDS, ROLES } from "../helpers/selectors.ts";
import { installFixtureClock } from "../helpers/clock.ts";

test.describe("borrow fee mode", () => {
  test.beforeEach(async ({ page }) => {
    await installFixtureClock(page);
    await page.goto("/");
    await page
      .getByRole(ROLES.modeSwitchBorrow.role, { name: ROLES.modeSwitchBorrow.name })
      .click();
    await expect(page.getByTestId(TESTIDS.borrowFeePage)).toBeVisible();
  });

  test("BF1: 表格有料、費率降序、高費率標色(SC-2/3 資料級 assertion)", async ({ page }) => {
    // 痛點:options-page-v2 fixture 事故 — visibility-only assertion 蓋不住
    // 資料路徑 silent 空(空表也 visible)。本 test 鎖 row 數 + 排序 + 標色,
    // FAKE fixture 斷線(檔名/欄名 drift)立即紅。
    const rows = page.getByTestId(TESTIDS.feeRow);
    await expect(rows.first()).toBeVisible();
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(4); // twse 3 檔 + tpex 2 檔 @ 06-26
    // 資料日 badge 對齊 FAKE_TODAY;當日有料 → 無非交易日註記
    await expect(page.getByText(/資料日 2026-06-26/)).toBeVisible();
    await expect(page.getByText(/非交易日/)).toHaveCount(0);
    // 費率降序 + tie-break:8046 與 5483 同 3.5% 同 3,000 股 → stock_id 升冪,
    // 首列 = 5483(backend 排序鍵 (-fee, -shares, stock_id) 的資料級鎖)
    const first = await rows.first().getAttribute("data-stock-id");
    expect(first).toBe("5483");
    // 高費率標色 cell 存在(8046 3.5% + 5483 3.5%)
    await expect(page.getByTestId(TESTIDS.feeHigh)).toHaveCount(2);
  });

  test("BF2: reload 後 borrow mode 持久化(SC-1)", async ({ page }) => {
    // 痛點:App.tsx useState init 讀 localStorage('mode');新 mode 值 'borrow'
    // 必須通過同一條持久化路徑(N2 只鎖 options,新枚舉值要自己的鎖)。
    await page.reload();
    await expect(page.getByTestId(TESTIDS.borrowFeePage)).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem("mode"));
    expect(stored).toBe("borrow");
  });
});
