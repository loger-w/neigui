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

  test("M1: 經典檢視(heatmap/leaderboard)已整刪(MK-4 mod/batch-ui-update)", async ({ page }) => {
    // 痛點:MK-4 刪除經典檢視後,heatmap / leaderboard / 折疊 toggle 不得殘留;
    // 三卡照常 render(由 M4 覆蓋 visibility)。
    await expect(page.getByTestId(TESTIDS.marketIndexStrength)).toBeVisible();
    await expect(page.getByTestId("market-heatmap")).toHaveCount(0);
    await expect(page.getByTestId("market-leaderboard")).toHaveCount(0);
    await expect(page.getByTestId("market-classic-toggle")).toHaveCount(0);
  });

  test("M4: 今日三卡渲染不 crash(mod/market-today-only)", async ({ page }) => {
    // 痛點:EOD 四卡退役後,四個 root 必須同時 visible(頁級 error 不得 key
    // 在任一卡)。null 降級路徑(「資料暫缺」)改由各卡 *.test.tsx vitest 覆蓋,
    // 這裡只鎖「populated fixture 下不 crash + 都掛上」。
    await expect(page.getByTestId(TESTIDS.marketIndexStrength)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.marketCapTiers)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.marketSectorRotation)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.marketUniverseBanner)).toBeVisible();
  });

  test("M9: 今日三卡 populated 資料級 assertion(mod/market-today-only)", async ({ page }) => {
    // 痛點:visibility-only 會被「資料暫缺」蓋住(options fixture 事故同型)
    // — 鎖 populated tick fixture 手算值(見 scripts/gen-market-e2e-fixtures.py
    // 頂部同源手算基準,改任一常數要雙邊同步)。
    //
    // 個股 change_rate(百分比語意,R7):2330 +0.90 / 2454 +0.50 / 2317 -1.20 /
    // 2412 +0.30 / 3008 -2.00。001 close=19820 change_price=-180 →
    // prev_close=20000 → change_rate=-0.90%;median(twse)=0.30 →
    // spread=-0.90-0.30=-1.20(中小強於指數)。101 close=392 change_price=-8
    // → change_rate=-2.00%(fixture 無 tpex-type 個股 → median/spread null,
    // contrib 兩側空陣列,見下方「無法資料級」註記)。
    // 貢獻點數(prev_close×Σmv_i×chg_i/100÷Σmv,twse Σmv=33.63e12):
    // 2330 +149.9(mv 最大+chg 最大)/ 2454 +5.4 / 2412 +1.7 上漲側;
    // 2317 -17.8 / 3008 -4.5 下跌側。
    // cap_tiers:mv 全 5 檔覆蓋、5 檔 < top50 門檻(50)全落 top50 —
    // avg=(0.9+0.5-1.2+0.3-2.0)/5=-0.30、up_ratio=3/5=60%(mid100/rest 無
    // 樣本,分桶邊界另有 backend/tests/test_market_today.py 201 檔 unit test
    // 覆蓋,fixture 只需鎖「可達桶有值」)。
    // sector_rotation(taiwan_stock_industry_chain.json 3 產業×2 子產業):
    // 半導體業 avg=(0.5+0.9)/2=0.70(desc 最高,vol_ratio=(20M+30M)/(10M+20M)
    // =1.67x hot)、電子零組件業 avg=-0.45(0.44x cold)、光電業 avg=-0.55
    // (1.07x)。

    const twseSide = page.getByTestId("idx-side-twse");
    await expect(twseSide).toContainText("19,820");
    await expect(twseSide).toContainText("-0.90%");
    await expect(twseSide).toContainText("中小強於指數(-1.20pp)");

    const tpexSide = page.getByTestId("idx-side-tpex");
    await expect(tpexSide).toContainText("392");
    await expect(tpexSide).toContainText("-2.00%");

    const tsmcRow = page.getByTestId("idx-tsmc");
    await expect(tsmcRow).toContainText("+0.90%");
    await expect(tsmcRow).toContainText("+149.9 點");

    const twseUp = page.getByTestId("idx-contrib-twse-up");
    await expect(twseUp).toContainText("台積電");
    await expect(twseUp).toContainText("+149.9");
    await expect(twseUp).toContainText("聯發科");
    await expect(twseUp).toContainText("中華電");
    const twseDown = page.getByTestId("idx-contrib-twse-down");
    await expect(twseDown).toContainText("鴻海");
    await expect(twseDown).toContainText("-17.8");
    await expect(twseDown).toContainText("大立光");

    // 無法資料級:fixture 5 檔 TaiwanStockInfo 皆 type=twse,無 tpex 個股 →
    // tpex 貢獻 top5 只能鎖「空陣列渲染」而非非空數值(見 change-spec 執行
    // 報告);median/spread 同理鎖 "—" 佔位。
    await expect(page.getByTestId("idx-contrib-tpex")).toContainText("無資料");

    await expect(page.getByTestId(TESTIDS.marketIndexStrength)).not.toContainText("資料暫缺");

    const capTierTop50 = page.getByTestId("cap-tier-top50");
    await expect(capTierTop50).toContainText("-0.30%");
    await expect(capTierTop50).toContainText("上漲比例 60%");

    const rotationList = page.getByTestId(TESTIDS.marketSectorRotation);
    const firstRow = page.locator('[data-testid^="sector-row-"]').first();
    await expect(firstRow).toHaveAttribute("data-testid", "sector-row-半導體業");
    await expect(firstRow).toContainText("+0.70%");
    await expect(firstRow.locator('[data-flag="hot"]')).toBeVisible();

    // MK-3(mod/batch-ui-update):整列點擊展開 → 子產業列;點副族群列 →
    // 成員股表巢狀內嵌該列下(走真 sector_members fetch,不 mock)。
    await page.getByTestId("sector-row-btn-半導體業").click();
    const subRow = page.getByTestId("sub-row-半導體業-晶圓代工");
    await expect(subRow).toBeVisible();
    await expect(subRow).toContainText("+0.90%");

    await subRow.click();
    const membersPanel = page.getByTestId("sector-members-panel");
    await expect(membersPanel).toBeVisible();
    const membersTable = page.getByTestId("sector-members-table");
    await expect(membersTable).toBeVisible();
    await expect(page.getByTestId("sector-member-2330")).toContainText("台積電");
    await expect(rotationList).not.toContainText("資料暫缺");
  });

});

test.describe("market mode @1440x900", () => {
  // viewport 用 test.use 在導航前固定 — setViewportSize 後量測會撞 resize
  // relayout race(曾假綠:量到 1280x720 的舊幾何)。
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await installFixtureClock(page);
    await page.addInitScript(() => localStorage.setItem("mode", "market"));
    await page.goto("/");
  });

  test("M7: 1440x900 新主視圖無 scroll — grid bottom ≤ viewport(SC-9)", async ({ page }) => {
    // 痛點:App root 是 flex-col(nav shrink-0 + page),MarketPage root 若用
    // h-full 會拿 100% 容器高(900)而非扣掉 nav 的剩餘空間 → 主視圖下溢
    // nav 高度(39px)被 App overflow-hidden 裁切。Phase 6 real-env 實測
    // grid bottom 939 > 900 抓到;量測語意照 design §11(R1-3):只量
    // market-v2-grid 元素本身,不量頁 scroll 容器。
    const grid = page.getByTestId("market-v2-grid");
    await expect(grid).toBeVisible();
    const box = await grid.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(900);
    const internal = await grid.evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(internal.scrollHeight).toBeLessThanOrEqual(internal.clientHeight);
  });
});

// responsive spec SC2:手機 viewport smoke。
test.describe("market mode — mobile viewport", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("M8: 375px 下 v2 grid 可見且無水平溢出", async ({ page }) => {
    // 痛點:主 grid grid-cols-1 堆疊;鎖 SC2 無水平溢出(經典檢視已於 MK-4 刪)。
    await installFixtureClock(page);
    await page.addInitScript(() => localStorage.setItem("mode", "market"));
    await page.goto("/");
    await expect(page.getByTestId("market-v2-grid")).toBeVisible();
    await expect(page.getByTestId(TESTIDS.marketIndexStrength)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});