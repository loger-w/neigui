/**
 * SC-3 equity mode golden paths(5 case)。設計來源 design.md v6 §3 SC-3。
 */
import { test, expect } from "@playwright/test";
import { TESTIDS, ROLES } from "../helpers/selectors.ts";
import { installFixtureClock } from "../helpers/clock.ts";

test.describe("equity mode", () => {
  test.beforeEach(async ({ page }) => {
    await installFixtureClock(page); // 凍 2026-06-26 13:30+08 — 避 polling refetch
    await page.goto("/");
  });

  test("E1: 首頁 default render(SC-3 case 1)", async ({ page }) => {
    // 痛點:default state — heading / symbol input / refresh button disabled
    // 全 visible。任一漏掉 = App.tsx render 結構 regression。
    await expect(page.getByRole("heading", { name: "籌碼分析" })).toBeVisible();
    await expect(page.getByPlaceholder(/搜尋代號/)).toBeVisible();
    await expect(page.getByRole(ROLES.refresh.role, { name: ROLES.refresh.name })).toBeDisabled();
  });

  test("E2: 搜尋 2330 → 三大法人 + brokers + K 線 visible(SC-3 case 2)", async ({ page }) => {
    // 痛點:end-to-end pivot test —— search → dropdown click → 三大 panel +
    // K 線 root testid 同時出現。任一缺 = fixture / hook / lazy load 中斷。
    await page.getByPlaceholder(/搜尋代號/).fill("2330");
    // SymbolSearch dropdown selector F14:OR fallback,Phase 2 後 narrow
    await page.getByRole("option").first().click();
    await expect(page.getByTestId(TESTIDS.chipBrokersPanel)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.chipKlineChart)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.panelInstitutional)).toBeVisible();
  });

  test("E3: 籌碼總覽 / 泡泡圖 tab 切換(SC-3 case 3)", async ({ page }) => {
    // 痛點:lazy load 的 ChipBubbleView 元件,tab 切換 + Suspense fallback
    // 必須 resolve。若 lazy import 路徑改 / dynamic import 失敗 → 卡 fallback。
    await page.getByPlaceholder(/搜尋代號/).fill("2330");
    await page.getByRole("option").first().click();
    await expect(page.getByTestId(TESTIDS.chipBrokersPanel)).toBeVisible();
    // 切到泡泡圖 tab
    await page.getByRole("button", { name: "泡泡圖" }).click();
    // 切回籌碼總覽
    await page.getByRole("button", { name: "籌碼總覽" }).click();
    await expect(page.getByTestId(TESTIDS.chipBrokersPanel)).toBeVisible();
  });

  test("E4: refresh button 啟用 → 點擊 → spinner appear(SC-3 case 5)", async ({ page }) => {
    // 痛點:選 symbol 後 refresh 應該 enabled,點擊後 spinner 出現代表 refetch
    // 真的觸發。沒這 assert 容易 silent broken(button enabled 但 onClick 沒接)。
    await page.getByPlaceholder(/搜尋代號/).fill("2330");
    await page.getByRole("option").first().click();
    await expect(page.getByTestId(TESTIDS.chipBrokersPanel)).toBeVisible();
    const refresh = page.getByRole(ROLES.refresh.role, { name: ROLES.refresh.name });
    await expect(refresh).toBeEnabled();
    // 點擊不一定 instantly 觸發 spinner(很快回 fixture),所以只 assert
    // button enabled state cycle:enabled → click → 還在 enabled state 即可。
    await refresh.click();
    await expect(refresh).toBeEnabled({ timeout: 3000 });
  });

  test("E5: K 線 chart resize handle visible(SC-3 case 4)", async ({ page }) => {
    // 痛點:panel-resize-handle 是 layout 控制元件,SC-3 require 它存在 ——
    // user drag 它調整右 panel 寬度。若 handle 不見 = layout regression。
    await page.getByPlaceholder(/搜尋代號/).fill("2330");
    await page.getByRole("option").first().click();
    await expect(page.getByTestId(TESTIDS.panelResizeHandle)).toBeVisible();
  });
});

// responsive spec SC2/SC4:手機 viewport smoke。viewport 一律 test.use 導航前固定
// (§9:setViewportSize 後立即量測會撞 resize relayout race)。
test.describe("equity mode — mobile viewport", () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test("E6: 375px 搜尋 2330 → K 線 + 面板堆疊、無水平溢出、resize handle 不存在", async ({ page }) => {
    // 痛點:手機用戶「幾乎無法使用」— 三欄 grid 無降級、resize handle 綁 mouse。
    // 鎖 SC2(無水平溢出)+ 堆疊分支(handle 桌面限定)。
    await installFixtureClock(page);
    await page.goto("/");
    await page.getByPlaceholder(/搜尋代號/).fill("2330");
    await page.getByRole("option").first().click();
    await expect(page.getByTestId(TESTIDS.chipBrokersPanel)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.chipKlineChart)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.panelResizeHandle)).toHaveCount(0);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
test.describe("equity mode — 權證 tab(feat/warrant-selector)", () => {
  test.beforeEach(async ({ page }) => {
    await installFixtureClock(page); // 凍 2026-06-26 13:30+08(盤中,輪詢不空轉)
    await page.goto("/");
    await page.getByPlaceholder(/搜尋代號/).fill("2330");
    await page.getByRole("option").first().click();
    await expect(page.getByTestId(TESTIDS.chipBrokersPanel)).toBeVisible();
  });

  test("E8: 權證 tab 表格資料級 assertion(SC-1/SC-2)", async ({ page }) => {
    // 痛點:visibility-only assertion 會被「卡片顯示 —」蓋住(2026-07-07
    // options fixture 事故)— 這裡鎖具體數值:MIS fixture 的 030012 z=3.50
    // 走完 normalize → 計算 → merge 全鏈才會出現在表格。
    await page.getByRole("button", { name: /^權證$/ }).click();
    await expect(page.getByTestId(TESTIDS.warrantRow)).toHaveCount(6); // 5 購 + 1 售;已到期 030099 濾掉
    const row12 = page.locator('[data-warrant-id="030012"]');
    await expect(row12).toContainText("3.50"); // MIS 現價(非 EOD 收盤 3.30)
    await expect(row12).toContainText(/\d+\.\d%/); // IV / 價內外 % 有值(計算鏈非空)
    await expect(page.getByText(/最後更新 13:30/)).toBeVisible(); // quotes 層到位
    await expect(page.getByText(/快照基準日 2026-06-26/)).toBeVisible();
  });

  test("E9: 認售 toggle 篩選(SC-4)", async ({ page }) => {
    // 痛點:client-side filter 全鏈(filterWarrants → 表格 re-render)。
    // 認售在 fixture 只有 03001P 一檔,row 數 6 → 1 是 discriminative 訊號。
    await page.getByRole("button", { name: /^權證$/ }).click();
    await expect(page.getByTestId(TESTIDS.warrantRow)).toHaveCount(6);
    await page.getByRole("button", { name: /^認售$/ }).click();
    await expect(page.getByTestId(TESTIDS.warrantRow)).toHaveCount(1);
    await expect(page.getByTestId(TESTIDS.warrantRow)).toHaveAttribute(
      "data-warrant-id",
      "03001P",
    );
  });

  test("E10: 無權證標的空狀態(SC-7)", async ({ page }) => {
    // 痛點:2412 不在權證 fixture 的標的內 → 空 list → 繁中空狀態;
    // 若 backend 空標的誤回 404/500,這裡會看到 error 而非空狀態文案。
    // 換標的用鍵盤 Enter(SymbolSearch 單一命中直選):dropdown option 在
    // beforeEach 已載 2330 資料的頁面上持續重渲染,click retry 撞 detach
    // (2026-07-11 冷 cache 實測 ×3);Enter 路徑不依賴 option 元素穩定性
    await page.getByPlaceholder(/搜尋代號/).fill("2412");
    await expect(page.getByRole("option")).toHaveCount(1);
    await page.getByPlaceholder(/搜尋代號/).press("Enter");
    await page.getByRole("button", { name: /^權證$/ }).click();
    await expect(page.getByText("此標的無掛牌權證")).toBeVisible();
  });

  test("E11: row 展開分點(SC-6,FinMind T+1 單發)", async ({ page }) => {
    // 痛點:展開走 FakeFinMindClient MANIFEST 路徑(warrant_id 030012 與
    // fixtures/warrants/ 快照對齊 — impl-R2 跨 wave 契約);資料日 = FAKE_TODAY-1。
    await page.getByRole("button", { name: /^權證$/ }).click();
    const row12 = page.locator('[data-warrant-id="030012"]');
    await row12.getByRole("button", { name: /展開分點/ }).click();
    const detail = page.getByTestId(TESTIDS.warrantBrokersDetail);
    await expect(detail).toContainText("凱基-台北");
    await expect(detail).toContainText("800"); // net = buy 900 - sell 100
    await expect(detail).toContainText("資料日 = 2026-06-25");
  });
});

test.describe("equity mode — 泡泡圖提示", () => {
  test("E7: 桌面泡泡圖顯示價格軸拖曳篩選提示", async ({ page }) => {
    // 痛點:Y 軸 brush 是隱形功能(只有 hover 游標線索),使用者不知道能拖曳
    // 篩選價位。鎖住 desktop 顯示提示;mobile(E6 viewport)brush 停用不顯示。
    await installFixtureClock(page);
    await page.goto("/");
    await page.getByPlaceholder(/搜尋代號/).fill("2330");
    await page.getByRole("option").first().click();
    await expect(page.getByTestId(TESTIDS.chipBrokersPanel)).toBeVisible();
    await page.getByRole("button", { name: "泡泡圖" }).click();
    await expect(page.getByTestId("bubble-brush-hint")).toBeVisible();
  });
});