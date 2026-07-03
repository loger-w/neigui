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

  test("M4: v2 panels 空狀態渲染不 crash(SC-11b)", async ({ page }) => {
    // 痛點:FAKE_FINMIND 缺全市場 TaiwanStockPrice window + TAIEX fixture,
    // 四個 EOD 欄位必 null → panel 走「資料暫缺」降級。此 spec 鎖「null 不炸頁」
    // (契約事實 2:頁級 error 不得 key 在四欄)。populated fixture 列 next-time(D-3)。
    await expect(page.getByTestId(TESTIDS.marketBreadthPanel)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.marketSectorBreadthHeatmap)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.marketSectorAmountShare)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.marketSectorVolRatio)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.marketUniverseBanner)).toBeVisible();
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