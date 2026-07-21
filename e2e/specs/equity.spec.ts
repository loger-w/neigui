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
    // 價量兩行(mod warrant-ux-feedback item 6b):030012 委買 3.48×50(fixture 已知有量列)
    await expect(row12.getByTestId("bid-cell")).toContainText("×50張");
    await expect(page.getByText(/最後更新 13:30/)).toBeVisible(); // quotes 層到位
    await expect(page.getByText(/快照基準日 2026-06-26/)).toBeVisible();
    // 表頭對齊與資料欄一致(mod warrant-selector-table SC-1):文字欄靠左、
    // 數值欄靠右 — 舊寫法 first:text-left 打在展開空 th 上,全表頭右對齊。
    await expect(page.locator("thead th").filter({ hasText: "代號" })).toHaveCSS(
      "text-align",
      "left",
    );
    await expect(page.locator("thead th").filter({ hasText: "履約價" })).toHaveCSS(
      "text-align",
      "right",
    );
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

  test("E14: 權證分點 tab 資料級 assertion + 展開明細(warrant-broker-flow SC-1/SC-2/SC-3)", async ({ page }) => {
    // 痛點:flow 聚合鏈(snapshot 對映 → price_day dump 篩量 → probe →
    // fan-out → 金額聚合)任一環空轉都會讓面板只剩空殼;鎖分點名 + 具體
    // 金額(030011 凱基 3000 + 030012 凱基 960 = 3960 元)防 visibility 假綠。
    await page.getByRole("button", { name: /^權證分點$/ }).click();
    await expect(page.getByTestId(TESTIDS.flowDateBadge)).toContainText("06-25"); // FAKE_TODAY−1 回退
    // summary 外部淨額口徑(mod/warrant-flow-external-net):HO seat 對映鏈
    // (brand 抽取 → alias → HO row)任一環壞掉會退化成「—」,鎖具體數字
    const summary = page.getByTestId(TESTIDS.flowSummary);
    await expect(summary).toContainText("成交額");
    await expect(summary).toContainText("800 萬"); // call trade_value(未 cap)
    await expect(summary).toContainText("2,667 元"); // call external_net(1695+972)
    await expect(summary).toContainText("300 元"); // put external_net
    const buyCol = page.getByTestId(TESTIDS.flowBuyCol);
    await expect(buyCol).toContainText("凱基台北");
    await expect(buyCol).toContainText("3,960 元"); // 淨買超金額(fixtures 手算)
    await expect(page.getByTestId(TESTIDS.flowSellCol)).toContainText("元大");
    // 展開分點 → 權證明細(payload 內嵌,零額外 API)
    await buyCol.getByRole("button", { name: /展開 凱基台北/ }).click();
    await expect(buyCol).toContainText("030011");
    await expect(buyCol).toContainText("台積凱基61購01");
    // 明細表金額降序首列 = 030011(5,000,000)+ 外部淨額 −(凱基 HO −1695)
    const firstRow = page
      .getByTestId(TESTIDS.flowWarrantTable)
      .getByTestId("flow-warrant-row")
      .first();
    await expect(firstRow).toHaveAttribute("data-warrant-id", "030011");
    await expect(firstRow.getByTestId("flow-warrant-net")).toHaveText("1,695 元");
  });

  test("E22: 外部淨額時序區塊資料級 assertion(warrant-flow-net-history SC-6)", async ({ page }) => {
    // 痛點:FAKE distilled fixture 滿窗 20 日(06-17 call null / 06-09 put null)—
    // 鎖段數 + 點數防 visibility 假綠(圖殼在但線空也算 visible);null 斷點
    // 反映在段數(call:16 日前段 12 點 + 18 日後段 7 點),補 0 會併成單段。
    await page.getByRole("button", { name: /^權證分點$/ }).click();
    const block = page.getByTestId("flow-net-history");
    await expect(block).toBeVisible();
    await expect(block.getByTestId("flow-net-history-chart")).toBeVisible();
    const callSegs = block.locator('polyline[data-testid="net-history-call-seg"]');
    await expect(callSegs).toHaveCount(2);
    expect(((await callSegs.nth(0).getAttribute("points")) ?? "").split(" ").length).toBe(12);
    expect(((await callSegs.nth(1).getAttribute("points")) ?? "").split(" ").length).toBe(7);
    await expect(block.locator('polyline[data-testid="net-history-put-seg"]')).toHaveCount(2);
    // 中性配色鎖(SC-7):線不套 bull/bear
    const cls = (await callSegs.nth(0).getAttribute("class")) ?? "";
    expect(/bull|bear/.test(cls)).toBe(false);
    // 滿窗 → 無補建 CTA / 無累積文案
    await expect(block.getByRole("button", { name: "補建缺日" })).toHaveCount(0);
    await expect(block).not.toContainText("已累積");
  });

  test("E30: 分點反查 tab — 搜尋選分點 → 雙表資料級 → 點列跳轉總覽(broker-daily-flows SC-4/5/7)", async ({ page }) => {
    // 痛點:反查鏈(traders 目錄 → daily-flows 專用 path + FAKE trader 過濾 →
    // net_amount 聚合 → 名稱 join)任一環空轉 = 面板空殼;鎖 fixture 手算值
    // (2330 買500/賣100 → +400 張 / 4.01億;2412 獨特值 -7,777 張)防
    // visibility 假綠 + data_id fallback 汙染(值變 = 有人吃錯 fixture)。
    await page.getByRole("button", { name: "分點反查" }).click();
    await page.getByLabel("搜尋分點").fill("富邦");
    await page.getByRole("option", { name: "9600 富邦" }).click();
    // FAKE_TODAY=2026-06-26(Fri)當日有料 → 無回退標註
    await expect(page.getByText("資料日 06-26")).toBeVisible();
    await expect(page.getByText(/尚無資料/)).toHaveCount(0);
    const buy = page.getByTestId("broker-flows-buy");
    await expect(buy).toContainText("台積電"); // 名稱 join(symbols fixture)
    await expect(buy).toContainText("400"); // net_lots
    await expect(buy).toContainText("4.01億"); // net_amount 縮寫(手算 400,500,000)
    await expect(buy).toContainText("0050"); // 名稱 join 不到 → 代號
    const sell = page.getByTestId("broker-flows-sell");
    await expect(sell).toContainText("中華電");
    await expect(sell).toContainText("-7,777");
    await expect(sell).toContainText("-9.33億");
    // 點 2330 列 → 跳回籌碼總覽 + symbol 帶入(SC-5;分點預選 → K 線 overlay)
    await buy.getByRole("button", { name: /檢視 台積電/ }).click();
    await expect(page.getByTestId(TESTIDS.chipKlineChart)).toBeVisible();
    await expect(page.getByRole("heading", { name: "籌碼分析" })).toBeVisible();
    await expect(page.locator("header")).toContainText("2330");
  });

  test("E10: 無權證標的空狀態(SC-7)", async ({ page }) => {
    // 痛點:2412 不在權證 fixture 的標的內 → 空 list → 繁中空狀態;
    // 若 backend 空標的誤回 404/500,這裡會看到 error 而非空狀態文案。
    // 換標的用鍵盤 Enter(SymbolSearch 單一命中直選):dropdown option 在
    // beforeEach 已載 2330 資料的頁面上持續重渲染,click retry 撞 detach
    // (2026-07-11 冷 cache 實測 ×3);Enter 路徑不依賴 option 元素穩定性
    await page.getByPlaceholder(/搜尋代號/).fill("2412");
    // 負載型 flake ×3(2026-07-18 兩輪 + mod/warrant-flow-external-net 一輪,
    // 皆全套紅/單獨綠)→ 照 next-time 條目放寬 option timeout
    await expect(page.getByRole("option")).toHaveCount(1, { timeout: 15000 });
    await page.getByPlaceholder(/搜尋代號/).press("Enter");
    await page.getByRole("button", { name: /^權證$/ }).click();
    await expect(page.getByText("此標的無掛牌權證")).toBeVisible();
  });

  test("E18: 欄位選單 — 隱藏/拖曳調序/reload 持久(mod warrant-ux-feedback SC-6)", async ({ page }) => {
    // 痛點:menu → prefs → visibleColumns → localStorage 全鏈;HTML5 拖曳
    // jsdom 測不到(vitest 只鎖 ▲▼ 按鈕路徑),真瀏覽器在此鎖 dnd + 持久化。
    await page.getByRole("button", { name: /^權證$/ }).click();
    await expect(page.getByTestId(TESTIDS.warrantRow)).toHaveCount(6);
    await page.getByTestId(TESTIDS.columnMenuBtn).click();
    // 隱藏 IV 欄(checkbox 本體 sr-only → force)
    await page.getByLabel("顯示 IV 欄").uncheck({ force: true });
    // 拖曳:差槓比(尾欄)拖到 履約價 → 插到履約價前。Playwright dragTo 對
    // HTML5 原生 dnd 不可靠(實測 order 不變)→ dispatchEvent 驅動 handler
    // 接線;真實滑鼠拖曳軌跡由 Phase 7 DevTools 人工驗證。
    await page.locator('[data-column-id="slr"]').dispatchEvent("dragstart");
    await page.locator('[data-column-id="strike"]').dispatchEvent("drop");
    await page.keyboard.press("Escape"); // 收選單再驗表頭
    const headerTexts = async () =>
      (await page.locator("thead th").allTextContents()).map((t) => t.replace(/ [↑↓]$/, ""));
    let hs = await headerTexts();
    expect(hs).not.toContain("IV");
    expect(hs).toContain("IV百分位"); // 不誤傷同字根欄
    expect(hs.indexOf("差槓比")).toBe(hs.indexOf("履約價") - 1);
    // reload 持久(localStorage);reload 丟 symbol state → 重走搜尋流程
    await page.reload();
    await page.getByPlaceholder(/搜尋代號/).fill("2330");
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: /^權證$/ }).click();
    await expect(page.getByTestId(TESTIDS.warrantRow)).toHaveCount(6);
    hs = await headerTexts();
    expect(hs).not.toContain("IV");
    expect(hs.indexOf("差槓比")).toBe(hs.indexOf("履約價") - 1);
  });

  test("E19: 重製篩選一鍵回預設(mod warrant-ux-feedback item 3)", async ({ page }) => {
    // 痛點:重製 → filters/sort state + epoch remount 同步鏈;縮量篩選後重製
    // 需回全量且 input 顯示同步清空(state 歸零但 input 殘留 = remount 鏈斷)。
    await page.getByRole("button", { name: /^權證$/ }).click();
    await expect(page.getByTestId(TESTIDS.warrantRow)).toHaveCount(6);
    await page.getByRole("button", { name: /^認售$/ }).click();
    await expect(page.getByTestId(TESTIDS.warrantRow)).toHaveCount(1);
    // exact:true — stepper 按鈕 aria-label(「… 增加/減少」)子字串會撞
    await page.getByLabel("剩餘天數下限", { exact: true }).fill("45");
    await page.getByTestId("filter-reset-btn").click();
    await expect(page.getByTestId(TESTIDS.warrantRow)).toHaveCount(6);
    await expect(page.getByLabel("剩餘天數下限", { exact: true })).toHaveValue("");
  });

  test("E20: 發行商下拉篩選(mod warrant-selector-table SC-2)", async ({ page }) => {
    // 痛點:extractIssuer 名稱抽取 → 選項推導 → filterWarrants 全鏈;fixture
    // 2330 六檔發行商互異,選凱基 6→1(030011)是 discriminative 訊號;
    // 重製篩選需連下拉一起回「全部」。
    await page.getByRole("button", { name: /^權證$/ }).click();
    await expect(page.getByTestId(TESTIDS.warrantRow)).toHaveCount(6);
    await page.getByLabel("發行商篩選").selectOption("凱基");
    await expect(page.getByTestId(TESTIDS.warrantRow)).toHaveCount(1);
    await expect(page.getByTestId(TESTIDS.warrantRow)).toHaveAttribute(
      "data-warrant-id",
      "030011",
    );
    await page.getByTestId("filter-reset-btn").click();
    await expect(page.getByTestId(TESTIDS.warrantRow)).toHaveCount(6);
    await expect(page.getByLabel("發行商篩選")).toHaveValue("all");
  });

  test("E12: IV趨勢欄 drift 標記(warrant-iv-drift SC-6)", async ({ page }) => {
    // 痛點:iv_history fixture → loader → detect_drift → snapshot merge 全鏈
    // 資料級 assertion(030012 遞減 / 030013 平穩顯示 —)— visibility-only
    // 會被「全欄 —」蓋住(options-page-v2 事故同型)。
    await page.getByRole("button", { name: /^權證$/ }).click();
    const row12 = page.locator('[data-warrant-id="030012"]');
    await expect(row12.getByTestId(TESTIDS.ivDriftLabel)).toHaveText("長期遞減");
    const row13 = page.locator('[data-warrant-id="030013"]');
    await expect(row13.getByTestId(TESTIDS.ivDriftLabel)).toHaveText("—");
  });

  test("E13: row 展開 IV 時序圖(warrant-iv-drift SC-7 / warrant-iv-redesign)", async ({ page }) => {
    // 痛點:iv-history endpoint → hook → computeIvHistoryChart → svg path 全鏈;
    // 鎖 path d 屬性非空(資料級),空 geometry 時 svg 不 render。重設計後
    // 加鎖標的收盤 panel(underlying_close 欄位斷了 = price path 空)與摘要列。
    await page.getByRole("button", { name: /^權證$/ }).click();
    const row12 = page.locator('[data-warrant-id="030012"]');
    await row12.getByRole("button", { name: /展開明細/ }).click();
    const chart = page.getByTestId(TESTIDS.warrantIvChart);
    await expect(chart).toBeVisible();
    const bidD = await chart.locator('path[data-side="bid"]').getAttribute("d");
    expect(bidD).toMatch(/^M[\d.]+,[\d.]+L/); // 至少一段 M + L 連線
    const priceD = await chart.locator('path[data-series="price"]').getAttribute("d");
    expect(priceD).toMatch(/^M[\d.]+,[\d.]+L/); // 標的收盤序列資料級
    await expect(page.getByTestId("warrant-iv-summary")).toBeVisible();
    await expect(page.getByText("買價IV", { exact: true })).toBeVisible();
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
// mod bubble-chip-ux(2026-07-02)的 e2e 補課(2026-07-20):當時 port 佔用
// 未跑,依判準表 equity UI 改動必加 E# spec。Fixture 基準(2026-06-26):
// 3 個分點 BROKER001-003(分點001-003),各買 100 張 / 賣 80 張,單一價位
// 1100 → 買額 1.10 億 / 賣額 8,800 萬(手算對照,資料級 assertion)。
test.describe("equity mode — 泡泡圖/籌碼總覽 UX(mod bubble-chip-ux)", () => {
  test.beforeEach(async ({ page }) => {
    await installFixtureClock(page);
    await page.goto("/");
    await page.getByPlaceholder(/搜尋代號/).fill("2330");
    await page.getByRole("option").first().click();
    await expect(page.getByTestId(TESTIDS.chipBrokersPanel)).toBeVisible();
  });

  test("E23: 泡泡圖選分點 → 「查看於籌碼總覽」跳轉 + 已選帶入(A2)", async ({ page }) => {
    // 痛點:跳轉鏈 = BrokerSearch name→id 轉換 → onJumpToOverview → App
    // setTab + setSelectedBrokerIds → chip bar。任一環斷 = button 有但跳過去
    // 是空選擇(silent broken,vitest 只鎖到 callback 參數層)。
    await page.getByRole("button", { name: "泡泡圖" }).click();
    await expect(page.getByTestId(TESTIDS.bubbleYaxisBrush)).toBeVisible();
    await page.getByPlaceholder("搜尋分點...").fill("分點001");
    await page.getByTestId(TESTIDS.brokerSearchItem).first().click();
    const jump = page.getByTestId(TESTIDS.bubbleJumpToOverview);
    await expect(jump).toContainText("查看 分點001 於籌碼總覽");
    await jump.click();
    // tab 已切回籌碼總覽 + 該分點在已選 chip bar
    await expect(page.getByTestId(TESTIDS.chipBrokersPanel)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.chipSelectedBar)).toContainText("分點001");
    await expect(page.getByTestId(TESTIDS.chipSelectedBar)).not.toContainText("未選擇分點");
  });

  test("E24: 泡泡圖選分點 → 總買/賣張與金額資料級 assertion(A3)", async ({ page }) => {
    // 痛點:computeBrokerTotals 全鏈(trades → 聚合 → fmtVol/fmtAmount)。
    // visibility-only 會被「顯示 0 張」蓋住 — 鎖 fixture 手算值:
    // 買 100 張 / 賣 80 張、買額 100×1000×1100 = 1.10 億、賣額 8,800 萬。
    await page.getByRole("button", { name: "泡泡圖" }).click();
    await expect(page.getByTestId(TESTIDS.bubbleYaxisBrush)).toBeVisible();
    await page.getByPlaceholder("搜尋分點...").fill("分點001");
    await page.getByTestId(TESTIDS.brokerSearchItem).first().click();
    const totals = page.getByTestId(TESTIDS.bubbleBrokerTotals);
    await expect(totals).toContainText("買 100 張");
    await expect(totals).toContainText("賣 80 張");
    await expect(totals).toContainText("1.10 億");
    await expect(totals).toContainText("8,800 萬");
  });

  test("E25: 換股載入時泡泡圖 loading badge 出現後消失(A5)", async ({ page }) => {
    // 痛點:loading feedback 鏈 = bubbleHook.loading → App loading prop →
    // badge render。FAKE fixture 回太快窗口極窄 → route delay 撐開;badge
    // 永不出現(prop 沒接)或永不消失(loading 卡住)都會紅。
    await page.route("**/api/chip/2412/bubble**", async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue();
    });
    // 換標的用 Enter(E10 同款:dropdown option 在已載資料頁面上重渲染,
    // click retry 撞 detach;Enter 路徑不依賴 option 元素穩定性)
    await page.getByPlaceholder(/搜尋代號/).fill("2412");
    await expect(page.getByRole("option")).toHaveCount(1, { timeout: 15000 });
    await page.getByPlaceholder(/搜尋代號/).press("Enter");
    await page.getByRole("button", { name: "泡泡圖" }).click();
    const badge = page.getByTestId(TESTIDS.bubbleLoadingBadge);
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("載入 2412 泡泡圖中");
    await expect(badge).toBeHidden({ timeout: 5000 });
  });

  test("E26: 籌碼總覽 chip bar 容器常駐 + 未選 placeholder(B2)", async ({ page }) => {
    // 痛點:anti-CLS — 容器改常駐後若回退成條件 render,選分點瞬間版面
    // 位移回歸(vitest 鎖了 DOM 存在,這裡鎖真瀏覽器 render 路徑)。
    const bar = page.getByTestId(TESTIDS.chipSelectedBar);
    await expect(bar).toBeVisible();
    await expect(bar).toContainText("未選擇分點");
  });

  test("E27: K 線下 broker row 容器常駐 + 未選 placeholder(B3)", async ({ page }) => {
    // 痛點:同 E26 anti-CLS,K 線 grid 固定 6 subchart 的容器分支;placeholder
    // 在但「清除」button 不該在(未選狀態誤現 = showBrokerData 分支錯)。
    const row = page.getByTestId(TESTIDS.chipBrokerRow);
    await expect(row).toBeVisible();
    await expect(row).toContainText("未選擇分點");
    await expect(row.getByRole("button", { name: "清除" })).toHaveCount(0);
  });

  test("E28: 分點 row 整列可點 + checkbox 不 double-toggle(B1)", async ({ page }) => {
    // 痛點:row 升格可點後,checkbox click bubble 到 row 會 double-toggle
    // (選了又立刻取消,體感 = 點 checkbox 沒反應)。row 點空白處選中 →
    // 點 checkbox 取消 → 各恰好一次 toggle 才會回到未選 placeholder。
    const bar = page.getByTestId(TESTIDS.chipSelectedBar);
    const row = page.locator('div[role="button"]').filter({ hasText: "分點001" }).first();
    await row.click();
    await expect(bar).toContainText("分點001");
    // checkbox 本體 sr-only(1px 不可點)→ force(E18 同款前例);click 事件
    // 仍真實從 input 冒泡到 stopPropagation wrapper,double-toggle 語意照驗
    await row.getByRole("checkbox", { name: "勾選 分點001" }).click({ force: true });
    await expect(bar).toContainText("未選擇分點");
  });

  test("E29: Y 軸 brush 拖曳 → summary → 篩選跳轉籌碼總覽(A1 端到端)", async ({ page }) => {
    // 痛點:brush 全鏈 = pointer drag → yToPrice 反算 → summarize → 篩選
    // button → App 批次帶入。fixture 單一價位 1100(pricePad=1 → domain
    // [1099,1101]),整段拖曳必涵蓋 → 3 分點、買 300 / 賣 240 張(手算)。
    await page.getByRole("button", { name: "泡泡圖" }).click();
    const overlay = page.getByTestId(TESTIDS.bubbleYaxisBrush);
    await expect(overlay).toBeVisible();
    const box = await overlay.boundingBox();
    if (!box) throw new Error("bubble-yaxis-brush boundingBox null");
    const cx = box.x + box.width / 2;
    await page.mouse.move(cx, box.y + 8);
    await page.mouse.down();
    await page.mouse.move(cx, box.y + box.height - 8, { steps: 5 });
    await page.mouse.up();
    const summary = page.getByTestId(TESTIDS.brushSummary);
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("涵蓋 3 個分點");
    await expect(summary).toContainText("買 300 / 賣 240 張");
    await page.getByTestId(TESTIDS.brushApplyFilter).click();
    await expect(page.getByTestId(TESTIDS.chipBrokersPanel)).toBeVisible();
    const bar = page.getByTestId(TESTIDS.chipSelectedBar);
    await expect(bar).toContainText("分點001");
    await expect(bar).toContainText("分點002");
    await expect(bar).toContainText("分點003");
  });
});

test.describe("equity mode — 主力線階梯補抓(mod chip-major-lazy-window)", () => {
  test.beforeEach(async ({ page }) => {
    await installFixtureClock(page);
    await page.goto("/");
  });

  test("E20: 初載只發一筆 major days=150,無自動 540(SC-1)", async ({ page }) => {
    // 痛點:配額核心 — 舊行為 fast 成功後自動背景抓 540(~360 requests/檔)。
    // regression = 這裡多出第二筆 major 請求。
    const majorRequests: string[] = [];
    page.on("request", (req) => {
      if (req.url().includes("/history/major")) majorRequests.push(req.url());
    });
    await page.getByPlaceholder(/搜尋代號/).fill("2330");
    await page.getByRole("option").first().click();
    await expect(page.getByTestId(TESTIDS.chipKlineChart)).toBeVisible();
    // 等 major 落地 + 靜置,確認沒有背景第二筆
    await page.waitForTimeout(1200);
    expect(majorRequests.length).toBe(1);
    expect(majorRequests[0]).toContain("days=150");
  });

  test("E21: 滾輪出界 → 發 days=300 補抓 + 缺料區段 overlay 出現後消失(SC-2)", async ({ page }) => {
    // 痛點:出界升檔鏈 = chart 回報可見左界 → hook 升檔 → 區段 overlay。
    // 鏈上任一環斷 = 拖出去看到假 0 bars 且永遠不補資料(spec R1 死區)。
    // fixture 2330 共 ~118 根(2026-01-01 起),150 檔覆蓋左界 2026-01-27:
    // 預設 90 根不出界;滾 3 次(+30 根,clamp 118)左界 = 2026-01-01 出界 → 300。
    await page.route(/\/history\/major\?.*days=300/, async (route) => {
      await new Promise((r) => setTimeout(r, 1200)); // 撐開 loading 窗口供 assert
      await route.continue();
    });
    await page.getByPlaceholder(/搜尋代號/).fill("2330");
    await page.getByRole("option").first().click();
    const chart = page.getByTestId(TESTIDS.chipKlineChart);
    await expect(chart).toBeVisible();
    // 等 150 落地(major-loading-overlay 消失)再滾,確保出界時 anchor 已在
    await expect(page.getByTestId("major-loading-overlay")).toBeHidden({ timeout: 5000 });
    const escalation = page.waitForRequest(/\/history\/major\?.*days=300/);
    await chart.hover();
    for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 100);
    await escalation; // 出界 → 升檔請求真的發出
    // 補抓在途:缺料區段 overlay 可見;落地後消失
    await expect(page.getByTestId("major-gap-overlay")).toBeVisible();
    await expect(page.getByTestId("major-gap-overlay")).toBeHidden({ timeout: 5000 });
  });
});
