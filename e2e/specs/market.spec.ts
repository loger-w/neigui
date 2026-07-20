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

  test("M2: heatmap 5 tiles(populated fixture 三向 join)", async ({ page }) => {
    // 痛點:market_value × tick_snapshot × sector_map(TaiwanStockInfo 入
    // _store,2026-07-20 populated fixture)三向 join;tile 數 5 是
    // discriminative 訊號 — 任一 join 環斷(如 TaiwanStockInfo 回退
    // skip_store)→ universe 全滅 tile 0 個。
    await expect(page.getByTestId("tile-2330")).toBeVisible();
    await expect(page.locator('[data-testid^="tile-"]')).toHaveCount(5);
  });

  test("M3: leaderboard 首列 2330 → 點擊 pivot 到 equity", async ({ page }) => {
    // 痛點:tick fixture distinct change_rate(2330 +0.9% 最大)→ gainers
    // 排序首列必為 2330;點擊走 App pivot 鏈(mode 切換 + symbol 帶入),
    // equity 資料管線(2330 全套 fixture)真的載起來才算通。
    const first = page.locator('[data-testid^="lb-row-"]').first();
    await expect(first).toHaveAttribute("data-testid", "lb-row-2330");
    await first.click();
    await expect(page.getByRole("heading", { name: "籌碼分析" })).toBeVisible();
    await expect(page.getByTestId(TESTIDS.chipBrokersPanel)).toBeVisible();
  });

  test("M4: v2 panels 渲染不 crash(SC-11b)", async ({ page }) => {
    // 痛點:五個 v2 panel root 必須同時 visible(頁級 error 不得 key 在
    // EOD 四欄 — 契約事實 2)。2026-07-20 populated fixture 後 EOD 有料,
    // null 降級路徑(「資料暫缺」)改由 MarketPage.test.tsx vitest 覆蓋。
    await expect(page.getByTestId(TESTIDS.marketBreadthPanel)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.marketSectorBreadthHeatmap)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.marketSectorAmountShare)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.marketSectorVolRatio)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.marketUniverseBanner)).toBeVisible();
  });

  test("M9: EOD 四欄 populated 資料級 assertion(next-time D-3 收割)", async ({ page }) => {
    // 痛點:visibility-only 會被「資料暫缺」蓋住(options fixture 事故同型)
    // — 鎖 populated fixture 手算值。fixture 設計(TaiwanStockPrice_universe
    // 2025-12-10..2026-06-26,143 交易日 × 5 檔):前段 2330/2454 反相交錯
    // ±1(每日 rana=0)、末日 3 up 2 down → rana=1000×(3-2)/5=200,前段
    // EMA 全 0 → McClellan = 200×(2/20 − 2/40) = 10.0 整。
    // 量比:半導體(2330+2454)末日 5M / 前 20 日均 2M = 2.50 hot;
    // 其他電子(2317+3008)1.3M / 2M = 0.65 cold。
    // 資金流向:半導體 6e9/10e9 = 60.0%(sector 歸屬含 _PRIMARY_INDUSTRY
    // _OVERRIDE:2317→其他電子、2412→通信網路)。
    const breadthPanel = page.getByTestId(TESTIDS.marketBreadthPanel);
    await expect(breadthPanel).toContainText("McClellan 10.0");
    await expect(breadthPanel).not.toContainText("資料暫缺");
    await expect(breadthPanel).not.toContainText("TAIEX 資料缺"); // TAIEX fixture 有料
    await expect(breadthPanel).toContainText("資料至 2026-06-26"); // eod_as_of 貫通

    const svrSemi = page.getByTestId("svr-row-半導體業");
    await expect(svrSemi).toContainText("2.50");
    await expect(svrSemi.locator('[data-flag="hot"]')).toBeVisible();
    const svrOther = page.getByTestId("svr-row-其他電子業");
    await expect(svrOther).toContainText("0.65");
    await expect(svrOther.locator('[data-flag="cold"]')).toBeVisible();

    await expect(page.getByTestId("sas-row-半導體業")).toContainText("60.0%");
    await expect(page.getByTestId("sb-cell-半導體業")).toContainText("100%");
  });

  test("M5: 經典檢視預設展開,舊 heatmap/leaderboard 可見(D-2,M1 顯性防回歸)", async ({ page }) => {
    // 痛點:layout 重組把舊 panel 收進折疊區,若預設收合 M1 靜默失效。
    await expect(page.getByTestId(TESTIDS.marketHeatmap)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.marketLeaderboard)).toBeVisible();
  });

  test("M6: 折疊 toggle → 舊 panel hidden → 再點恢復(SC-9 hidden 慣例)", async ({ page }) => {
    // 痛點:hidden attribute 慣例(保留 mount)— 若誤用條件 render,重展開會
    // 重新 mount 重抓資料。assert hidden 而非 detached。
    await page.getByTestId(TESTIDS.marketClassicToggle).click();
    await expect(page.getByTestId(TESTIDS.marketHeatmap)).toBeHidden();
    await page.getByTestId(TESTIDS.marketClassicToggle).click();
    await expect(page.getByTestId(TESTIDS.marketHeatmap)).toBeVisible();
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

  test("M8: 375px 下 v2 grid + heatmap 可見且無水平溢出", async ({ page }) => {
    // 痛點:classic 區 h-[560px] 曾在手機硬擠雙 panel(改 mobile 明確列高);
    // 主 grid grid-cols-1 堆疊。鎖 SC2 無水平溢出。
    await installFixtureClock(page);
    await page.addInitScript(() => localStorage.setItem("mode", "market"));
    await page.goto("/");
    await expect(page.getByTestId("market-v2-grid")).toBeVisible();
    await expect(page.getByTestId(TESTIDS.marketHeatmap)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});