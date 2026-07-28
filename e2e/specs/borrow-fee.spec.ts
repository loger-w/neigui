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

  test("BF3: 單檔篩選 — 選定只剩該檔、清除回全表(mod/borrow-fee-stock-filter SC-2/3)", async ({ page }) => {
    // 痛點:client-side filter 的資料級 assertion — 只驗 UI visible 蓋不住
    // 「filter 全空 / 全不過濾」兩種 silent 壞法;鎖選定後 row 數與
    // data-stock-id 全等,再鎖清除後回到原 row 數。
    const rows = page.getByTestId(TESTIDS.feeRow);
    await expect(rows.first()).toBeVisible();
    const fullCount = await rows.count();
    const filter = page.getByTestId(TESTIDS.borrowFeeStockFilter);
    await filter.fill("8046");
    await page.getByRole("option", { name: /8046/ }).click();
    await expect(rows).toHaveCount(1);
    expect(await rows.first().getAttribute("data-stock-id")).toBe("8046");
    await page.getByTestId(TESTIDS.stockFilterClear).click();
    await expect(rows).toHaveCount(fullCount);
  });

  test("BF4: 選股加總 summary — 本日合計 + 本月累計資料級(feat/borrow-fee-totals SC-3/4)", async ({ page }) => {
    // 痛點:同股同日多筆(8046 於 06/24 兩列)是 visibility-only 蓋不住的
    // 資料級語意 — summary 全鏈 = backend month_shares 全列相加 → payload →
    // 前端 dayTotal reduce。fixture 手算(scratchpad script 重算,非 design
    // 預估):8046 as_of 06-26 當日 1 列 3,000;當月 2,000+12,000(06/24)+
    // 3,000(06/26)= 17,000,distinct dates = 2。
    const filter = page.getByTestId(TESTIDS.borrowFeeStockFilter);
    await filter.fill("8046");
    await page.getByRole("option", { name: /8046/ }).click();
    const summary = page.getByTestId(TESTIDS.borrowFeeStockSummary);
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("本日標借合計 3,000 股");
    await expect(summary).toContainText("本月累計 17,000 股");
    await expect(summary).toContainText("(2 次)");
    // 清除選股 → summary 常駐、內容回占位(mod/borrow-fee-polish SC-2 改語意:
    // 區塊不增刪消除 header 跳動,原「消失」assertion 事前標該紅改寫)
    await page.getByTestId(TESTIDS.stockFilterClear).click();
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("本日標借合計 —");
  });

  test("BF5: 本日借券統計常駐右表 — 免搜尋可見、張數 desc、不受篩選連動(mod/borrow-fee-layout SC-1/2/3)", async ({ page }) => {
    // 痛點:本日合計原先要搜尋選股才可見(summary gate);統計表必須零互動
    // 即有資料級內容。fixture 手算(06-26 當日):8069=25,000 / 2434=21,000 /
    // 1513=14,000 / 5483=3,000 / 8046=3,000 → 張數 desc + 同值代號升冪。
    const stats = page.getByTestId(TESTIDS.borrowDayStats);
    await expect(stats).toBeVisible();
    const statRows = page.getByTestId(TESTIDS.dayStatRow);
    await expect(statRows).toHaveCount(5);
    const order: string[] = [];
    for (let i = 0; i < 5; i++) {
      order.push((await statRows.nth(i).getAttribute("data-stock-id")) ?? "");
    }
    expect(order).toEqual(["8069", "2434", "1513", "5483", "8046"]);
    // 張數換算資料級鎖:首列 8069 = 25,000 股 → 25 張
    await expect(statRows.first()).toContainText("25");
    // SC-3:單檔篩選只動左明細,統計表列數不變
    const filter = page.getByTestId(TESTIDS.borrowFeeStockFilter);
    await filter.fill("8046");
    await page.getByRole("option", { name: /8046/ }).click();
    await expect(page.getByTestId(TESTIDS.feeRow)).toHaveCount(1);
    await expect(statRows).toHaveCount(5);
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
