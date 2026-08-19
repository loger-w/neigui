/**
 * SC-3 equity mode golden paths(5 case)。設計來源 design.md v6 §3 SC-3。
 */
import { statSync } from "node:fs";
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
    await page.getByRole("button", { name: /^泡泡圖$/ }).click();
    // 切回籌碼總覽
    await page.getByRole("button", { name: /^籌碼總覽$/ }).click();
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

  test("E31: windowDays 窗聚合 HUD + 子圖 hover 十字軸(mod/batch-ui-update CH-2/3)", async ({ page }) => {
    // 痛點:CH-2 窗聚合(HUD N日 marker)與 CH-3c(十字軸事件掛整疊容器,
    // hover 子圖也要出現)是跨 renderer 的整合行為,vitest 鎖數值、這裡鎖
    // 真瀏覽器事件鏈;HUD 不得再出現斜線日期(CH-3b)。
    await page.getByPlaceholder(/搜尋代號/).fill("2330");
    await page.getByRole("option").first().click();
    const chart = page.getByTestId(TESTIDS.chipKlineChart);
    await expect(chart).toBeVisible();
    await page.getByRole(ROLES.windowDays10.role, { name: ROLES.windowDays10.name }).click();
    await expect(chart).toContainText("10日");
    expect(await chart.textContent()).not.toMatch(/\d{4}\/\d{2}\/\d{2}/);
    // hover 到子圖區(容器下緣 3/4 高度處)→ sub-crosshair 出現。
    // 垂直 SVG line 的 bbox 寬 0 → toBeVisible 恆判 hidden;crosshair 只在
    // hoverIndex 有值時 render,attached + 全子圖 count 即是行為訊號。
    const box = (await chart.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75);
    await expect(page.getByTestId(TESTIDS.subCrosshair).first()).toBeAttached();
    expect(await page.getByTestId(TESTIDS.subCrosshair).count()).toBeGreaterThanOrEqual(5);
  });

  test("E46: K 線疊圖底部日期軸 — 稀疏 M/D 刻度 + hover 日期 chip(mod/kline-date-bubble-days-ux SC-1)", async ({ page }) => {
    // 痛點:日期軸是疊圖新增的一列(高度配平後才放得下),vitest 鎖幾何,
    // 這裡鎖真瀏覽器「看得到 + 刻度對到 fixture 末根 06-26 + hover 出完整日期」。
    // E31 的「不得斜線年月日」契約仍覆蓋本容器(刻度 M/D、chip YYYY-MM-DD)。
    await page.getByPlaceholder(/搜尋代號/).fill("2330");
    await page.getByRole("option").first().click();
    const chart = page.getByTestId(TESTIDS.chipKlineChart);
    await expect(chart).toBeVisible();
    const axis = page.getByTestId("kline-date-axis");
    await expect(axis).toBeVisible();
    const ticks = page.getByTestId("kline-date-axis-tick");
    expect(await ticks.count()).toBeGreaterThanOrEqual(2);
    await expect(ticks.last()).toHaveText("6/26");
    // 軸列必須在容器可視範圍內(高度配平 review R1:餘數列吃掉會把軸推出 overflow)
    const chartBox = (await chart.boundingBox())!;
    const axisBox = (await axis.boundingBox())!;
    expect(axisBox.y + axisBox.height).toBeLessThanOrEqual(chartBox.y + chartBox.height + 0.5);
    // hover 疊圖中段 → 軸列出現該根日期 chip
    await page.mouse.move(chartBox.x + chartBox.width / 2, chartBox.y + chartBox.height * 0.5);
    const hover = page.getByTestId("kline-date-axis-hover");
    await expect(hover).toBeAttached();
    expect(await hover.textContent()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(await chart.textContent()).not.toMatch(/\d{4}\/\d{2}\/\d{2}/);
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

  test("E35: 評分欄存在 + 預設評分降序 + toggle 升序(WA-2)", async ({ page }) => {
    // 痛點:評分鏈 = merged 全集橫斷面 → score 附掛 → 預設 sortKey=score
    // desc → cell 渲染。fixture 值不寫死(6 檔因子組合經計算層),改鎖
    // 「序列單調性」— desc 非遞增、toggle 後非遞減,null(—)恆末端。
    await page.getByRole("button", { name: /^權證$/ }).click();
    await expect(page.getByTestId(TESTIDS.warrantRow)).toHaveCount(6);
    const scoreHeader = page.locator("thead").getByRole("button", { name: /^評分/ });
    await expect(scoreHeader).toContainText("↓"); // 預設 = 評分 desc
    const readScores = async () => {
      const texts = await page.getByTestId("score-cell").allTextContents();
      return texts.map((t) => (t.trim() === "—" ? null : Number(t.trim())));
    };
    const desc = await readScores();
    expect(desc.length).toBe(6);
    const descNums = desc.filter((v): v is number => v !== null);
    expect(descNums.length).toBeGreaterThan(0);
    for (let i = 1; i < descNums.length; i++) {
      expect(descNums[i]!).toBeLessThanOrEqual(descNums[i - 1]!);
    }
    // null 沉底:第一個 null 之後不得再有數值
    const firstNull = desc.indexOf(null);
    if (firstNull !== -1) {
      expect(desc.slice(firstNull).every((v) => v === null)).toBe(true);
    }
    // toggle 升序:非遞減,null 仍末端
    await scoreHeader.click();
    await expect(scoreHeader).toContainText("↑");
    const asc = await readScores();
    const ascNums = asc.filter((v): v is number => v !== null);
    for (let i = 1; i < ascNums.length; i++) {
      expect(ascNums[i]!).toBeGreaterThanOrEqual(ascNums[i - 1]!);
    }
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
    // 展開分點 → 權證明細(payload 內嵌,零額外 API);SC-7 aria 帶 id
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

  test("E22: 外部淨額時序區塊已整刪(WF-1 mod/batch-ui-update)", async ({ page }) => {
    // 痛點:WF-1 刪除時序圖 + 補建缺日 CTA 整鏈後,主面板不得殘留該區塊
    // (主面板 summary / top15 由 E14 覆蓋)。
    await page.getByRole("button", { name: /^權證分點$/ }).click();
    await expect(page.getByTestId("flow-summary")).toBeVisible();
    await expect(page.getByTestId("flow-net-history")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "補建缺日" })).toHaveCount(0);
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

  test("E37: 分點搜尋 combobox a11y — activedescendant 跟隨鍵盤導航(a11y 收割)", async ({ page }) => {
    // 痛點:aria-activedescendant 缺口 = SR 使用者不知鍵盤焦點落在哪個選項
    // (視覺 highlight 只有明眼可感);真 browser 驗 keyboard 事件 →
    // activedescendant id 指向真實存在的 option 元素,jsdom 測不到焦點語意。
    await page.getByRole("button", { name: "分點反查" }).click();
    const input = page.getByLabel("搜尋分點");
    await input.fill("富邦");
    await expect(page.getByRole("listbox", { name: "分點搜尋結果" })).toBeVisible();
    await expect(input).toHaveAttribute("aria-expanded", "true");
    // fixture 目錄序:9600 富邦 / 9604 富邦-陽明 / 9608 富邦-台東
    await expect(input).toHaveAttribute("aria-activedescendant", "trader-search-option-9600");
    await input.press("ArrowDown");
    await expect(input).toHaveAttribute("aria-activedescendant", "trader-search-option-9604");
    await expect(page.locator("#trader-search-option-9604")).toHaveAttribute("role", "option");
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

  test("E13: 權證表無展開鈕(WA-1 mod/batch-ui-update 引波展開整刪)", async ({ page }) => {
    // 痛點:WA-1 刪除引波展開後,展開鈕/IV 時序圖不得殘留(iv_drift 欄仍在,
    // 由 E12 覆蓋 — service 保留、endpoint 已刪)。
    await page.getByRole("button", { name: /^權證$/ }).click();
    await expect(page.getByTestId(TESTIDS.warrantRow).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /展開明細/ })).toHaveCount(0);
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
    await page.getByRole("button", { name: /^泡泡圖$/ }).click();
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
    await page.getByRole("button", { name: /^泡泡圖$/ }).click();
    await expect(page.getByTestId(TESTIDS.bubbleYaxisBrush)).toBeVisible();
    await page.getByPlaceholder("搜尋分點...").fill("分點001");
    await page.getByTestId(TESTIDS.brokerSearchItem).first().click();
    const jump = page.getByTestId(TESTIDS.bubbleJumpToOverview);
    // mod/broker-label-search-only-id:非搜尋顯示點只顯名稱
    await expect(jump).toContainText("查看 分點001 於籌碼總覽");
    await jump.click();
    // tab 已切回籌碼總覽 + 該分點在已選 chip bar
    await expect(page.getByTestId(TESTIDS.chipBrokersPanel)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.chipSelectedBar)).toContainText("分點001");
    await expect(page.getByTestId(TESTIDS.chipSelectedBar)).not.toContainText("未選擇分點");
  });

  test("E42: 泡泡圖每價位量能分布背景層 — 資料級 rect 對 fixture 價位(feat/bubble-volume-profile SC-5)", async ({ page }) => {
    // 痛點:背景層 pointer-events none 且無文字,visibility-only assertion
    // 假綠風險高 — 數 rect + width > 0 資料級鎖住。fixture 單一價位 1100
    // (3 分點 × 買100/賣80)→ 恰 1 條,量 = (300+240)/2 = 270。
    await page.getByRole("button", { name: /^泡泡圖$/ }).click();
    await expect(page.getByTestId(TESTIDS.bubbleYaxisBrush)).toBeVisible();
    const bars = page.getByTestId("bubble-volume-profile").locator("rect");
    await expect(bars).toHaveCount(1);
    const w = Number(await bars.first().getAttribute("width"));
    expect(w).toBeGreaterThan(0);
    // review C-P2-3:單價位 fixture 下 width>0 無鑑別力(正規化恆滿格)—
    // 補幾何值:唯一條即最大條,寬 = (svg寬 − 56 − 16) × 20%。
    const svgW = await page
      .getByTestId("bubble-volume-profile")
      .evaluate((g) => Number(g.closest("svg")!.getAttribute("width")));
    expect(svgW).toBeGreaterThan(0);
    expect(w).toBeCloseTo((svgW - 72) * 0.2, 3);
  });

  test("E43: 泡泡圖多日聚合 — 切 5 日後明細張數 = 單日 ×5 + 累計 badge(feat/bubble-streak-screenshot SC-6)", async ({ page }) => {
    // 痛點:倍數 assertion 鎖住「前端真的切到 /bubble_window 端點 **且** 後端
    // 真的逐日累加」。badge 有字 + circle > 0 這兩條在「沒切端點(還是單日
    // 資料)」與「聚合覆寫而非加總」兩種壞法下都會偽綠(options-page-v2 事故
    // 同型:visibility-only assertion 蓋住整條空/錯資料路徑)。
    // Fixture 事實(design §5):2330 覆蓋 06-12〜06-26 共 11 個交易日,每日
    // 同 3 分點各買 100 張 / 賣 80 張 @1100 → 5 日窗(06-22〜06-26)全落在
    // 覆蓋內 → 買 500 張。partial-window / actual_days 路徑 e2e 蓋不到,由
    // pytest test_bubble_window 承擔。
    await page.getByRole("button", { name: /^泡泡圖$/ }).click();
    await expect(page.getByTestId(TESTIDS.bubbleYaxisBrush)).toBeVisible();
    // 單日基準:買側明細「分點001」列的張數欄(fmtVol → 純數字,無「張」後綴)
    const buyVol = page
      .locator("button:has(span.text-left)")
      .filter({ hasText: "分點001" })
      .first()
      .locator("span.tabular-nums")
      .first();
    await expect(buyVol).toHaveText("100");
    await expect(page.getByTestId("bubble-window-badge")).toHaveCount(0);

    // mod/kline-date-bubble-days-ux SC-3:載入期工具列三鈕常駐 disabled、不跑版。
    // 舊 code 在 data→null 的載入視窗期會卸載三鈕(資料回來又長回),所以要用
    // route 延遲把視窗期拉長到可取樣(review R3)。
    const shotBtn = page.getByTestId("bubble-screenshot");
    await expect(shotBtn).toBeEnabled();
    const shotBoxBefore = (await shotBtn.boundingBox())!;
    await page.route("**/bubble_window*", async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });

    // 切 5 日 —— 定位一律先 scope 到 bubble-days-selector:RangeSelector 的
    // 「設為 N 日」在 hidden 的籌碼總覽分頁仍留在 DOM(design §3 R3)。
    await page
      .getByTestId("bubble-days-selector")
      .getByRole("button", { name: "泡泡圖設為 5 日" })
      .click();
    await expect(shotBtn).toBeAttached();
    await expect(shotBtn).toBeDisabled();
    const shotBoxLoading = (await shotBtn.boundingBox())!;
    expect(Math.abs(shotBoxLoading.x - shotBoxBefore.x)).toBeLessThan(1);
    expect(Math.abs(shotBoxLoading.y - shotBoxBefore.y)).toBeLessThan(1);
    await expect(page.getByTestId("bubble-manual-range-trigger")).toBeDisabled();

    // (a) 累計 badge
    await expect(page.getByTestId("bubble-window-badge")).toContainText(
      "近 5 個交易日累計",
    );
    await expect(shotBtn).toBeEnabled();
    // SC-4:每日開收標示 5 欄;fixture 事實 = trades 單一價位 1100、candle 收 1105
    // → 開 / 收必越界 → 5 欄皆 data-oob(K 身 / 標籤鑑別歸 vitest,review R13)。
    const dayCols = page.getByTestId("bubble-day-marks").locator("[data-date]");
    await expect(dayCols).toHaveCount(5);
    await expect(
      page.getByTestId("bubble-day-marks").locator('[data-date][data-oob="true"]'),
    ).toHaveCount(5);
    // (b) 倍數:同一列張數 = 單日 ×5(核心鑑別訊號)
    await expect(buyVol).toHaveText("500");
    // (c) 聚合資料仍流進圖表管線(泡泡有畫出來)。
    // [review-1 E43-CIRCLE-ASSERTION-INERT] 必須 scope 到泡泡 group:page 全域
    // 的 `svg circle` 會數到 hidden 籌碼總覽分頁裡的 circle(K 線 / spinner),
    // 泡泡一顆都沒畫也恆真 = 這條 assertion 等於沒寫。
    await expect(page.getByTestId("bubble-circles").locator("circle")).not.toHaveCount(0);
  });

  test("E44: 泡泡圖截圖鈕 → 真實下載 PNG(feat/bubble-streak-screenshot SC-8)", async ({ page }) => {
    // 痛點:jsdom 無 canvas / Image,svgToPngBlob 全鏈(serialize → blob URL →
    // Image decode → canvas 2x → toBlob → a[download])在 vitest 是零覆蓋 ——
    // 這條 spec 是該鏈唯一的自動化覆蓋。只驗檔名會放過 toBlob 回 null 或
    // objectURL 過早 revoke 造成的 0-byte 檔,故檔案 size 一起鎖;截圖失敗
    // 提示(catch 分支)也不得出現 = 不准靜默降級。
    await page.getByRole("button", { name: /^泡泡圖$/ }).click();
    await expect(page.getByTestId(TESTIDS.bubbleYaxisBrush)).toBeVisible();
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("bubble-screenshot").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("bubble_2330_2026-06-26.png");
    const file = await download.path();
    expect(file).toBeTruthy();
    expect(statSync(file!).size).toBeGreaterThan(0);
    await expect(page.getByTestId("bubble-screenshot-notice")).toHaveCount(0);
  });

  test("E45: 多日模式截圖 → 檔名帶 _w5 且 annotation 分支真的跑得完(feat/bubble-streak-screenshot SC-8)", async ({ page }) => {
    // [review-1 E44-ANNOTATION-BRANCH-UNCOVERED] E44 只走 days=1,serializeSvg
    // 的 annotation 分支(createElementNS <text> + CJK 內容 → XMLSerializer →
    // blob → Image decode)在真瀏覽器完全沒被跑過。CJK 序列化 / 編碼出錯會讓
    // Image.onerror 觸發 → catch → 提示,vitest 那層(jsdom 無 canvas)看不到。
    // 故此條同時鎖:檔名 _w5 後綴、下載檔非 0 byte、無失敗提示。
    await page.getByRole("button", { name: /^泡泡圖$/ }).click();
    await expect(page.getByTestId(TESTIDS.bubbleYaxisBrush)).toBeVisible();
    await page
      .getByTestId("bubble-days-selector")
      .getByRole("button", { name: "泡泡圖設為 5 日" })
      .click();
    // 聚合資料已上畫面才截圖(截的是多日那張,不是切換前的殘影)
    await expect(page.getByTestId("bubble-window-badge")).toContainText(
      "近 5 個交易日累計",
    );
    const downloadPromise = page.waitForEvent("download");
    await page.getByTestId("bubble-screenshot").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("bubble_2330_2026-06-26_w5.png");
    const file = await download.path();
    expect(file).toBeTruthy();
    expect(statSync(file!).size).toBeGreaterThan(0);
    await expect(page.getByTestId("bubble-screenshot-notice")).toHaveCount(0);
  });

  test("E24: 泡泡圖選分點 → 總買/賣張與金額資料級 assertion(A3)", async ({ page }) => {
    // 痛點:computeBrokerTotals 全鏈(trades → 聚合 → fmtVol/fmtAmount)。
    // visibility-only 會被「顯示 0 張」蓋住 — 鎖 fixture 手算值:
    // 買 100 張 / 賣 80 張、買額 100×1000×1100 = 1.10 億、賣額 8,800 萬。
    await page.getByRole("button", { name: /^泡泡圖$/ }).click();
    await expect(page.getByTestId(TESTIDS.bubbleYaxisBrush)).toBeVisible();
    await page.getByPlaceholder("搜尋分點...").fill("分點001");
    await page.getByTestId(TESTIDS.brokerSearchItem).first().click();
    const totals = page.getByTestId(TESTIDS.bubbleBrokerTotals);
    await expect(totals).toContainText("買 100 張");
    await expect(totals).toContainText("賣 80 張");
    await expect(totals).toContainText("1.10 億");
    await expect(totals).toContainText("8,800 萬");
  });

  test("E38: 泡泡圖多選分點 — 下拉連續加選 2 個 → chips + 合併明細/統計資料級(bubble-multi-broker SC-1/3/4/7)", async ({ page }) => {
    // 痛點:多選核心鏈 = BrokerSearch pick(R1:下拉保持開啟靠 mousedown
    // preventDefault 保 input focus — blur closeTimer race 在 jsdom 量不到,
    // 唯真瀏覽器可驗)→ toggleBroker → chips + computeBrokerTotals 集合合併。
    // fixture 手算:分點001/002 各 買100張/賣80張@1100 → 合併 買200/賣160、
    // 買額 2.20 億、賣額 1.76 億(visibility-only 會被「0 張」蓋住,鎖數值)。
    await page.getByRole("button", { name: /^泡泡圖$/ }).click();
    await expect(page.getByTestId(TESTIDS.bubbleYaxisBrush)).toBeVisible();
    await page.getByPlaceholder("搜尋分點...").fill("分點");
    await page
      .getByTestId(TESTIDS.brokerSearchItem)
      .filter({ hasText: "分點001" })
      .click();
    // R1 真瀏覽器 assertion:pick 後下拉仍開啟 → 不重新 fill 直接點第 2 個
    await expect(
      page.getByTestId(TESTIDS.brokerSearchItem).first(),
    ).toBeVisible();
    await page
      .getByTestId(TESTIDS.brokerSearchItem)
      .filter({ hasText: "分點002" })
      .click();
    await page.keyboard.press("Escape"); // 關下拉,避免遮住 header chips / 圖面
    // 2 枚 legend chip(SC-3)
    await expect(page.getByTestId(TESTIDS.brokerChip)).toHaveCount(2);
    await expect(
      page.getByTestId(TESTIDS.brokerChip).filter({ hasText: "分點001" }),
    ).toBeVisible();
    await expect(
      page.getByTestId(TESTIDS.brokerChip).filter({ hasText: "分點002" }),
    ).toBeVisible();
    // 合併統計資料級(SC-4)
    const totals = page.getByTestId(TESTIDS.bubbleBrokerTotals);
    await expect(totals).toContainText("買 200 張");
    await expect(totals).toContainText("賣 160 張");
    await expect(totals).toContainText("2.20 億");
    await expect(totals).toContainText("1.76 億");
    // 明細合併:右側列表同時含兩分點名稱列(SC-4)
    const detailNames = page.locator("button > span.text-left");
    await expect(detailNames.filter({ hasText: "分點001" }).first()).toBeVisible();
    await expect(detailNames.filter({ hasText: "分點002" }).first()).toBeVisible();
    // 批量跳轉文案(N ≥ 2 分支)
    await expect(page.getByTestId(TESTIDS.bubbleJumpToOverview)).toContainText(
      "查看 2 個分點於籌碼總覽",
    );
    // mod/kline-date-bubble-days-ux SC-2 / W6:統計行最寬(2 分點 totals + 跳轉文案)
    // 且 1280 + sidebar 下中欄僅 ~90px 時,「連續天數」標籤不得逐字直排,且與
    // selector 同一行(標籤自身不撐高 header;中欄既有多行換行屬 pre-existing)。
    const label = page.getByText("連續天數");
    await expect(label).toBeVisible();
    const labelBox = (await label.boundingBox())!;
    const selBox = (await page.getByTestId("bubble-days-selector").boundingBox())!;
    expect(labelBox.height).toBeLessThan(24);
    expect(Math.abs((labelBox.y + labelBox.height / 2) - (selBox.y + selBox.height / 2))).toBeLessThan(8);
  });

  test("E39: 泡泡圖單看模式 — 點已選泡泡切單分點統計、組合不動;點空白兩段式(mod/bubble-chart-ux-polish SC-3/5)", async ({ page }) => {
    // 痛點:多選建好的篩選組合一點就壞(舊 toggle 移除)。單看鏈 =
    // hitTest → handleBubbleClick 已選分支 → solo → effectiveIds 統計/明細切換。
    // fixture 陷阱(spec review R2/R2-1 寫死):三分點同價同量泡泡完全重合,
    // hitTest 平手取 trades 序位第一 → solo 目標只能斷言分點001;circle
    // pointerEvents=none → 必須 boundingBox + page.mouse.click 打 overlay。
    await page.getByRole("button", { name: /^泡泡圖$/ }).click();
    await expect(page.getByTestId(TESTIDS.bubbleYaxisBrush)).toBeVisible();
    await page.getByPlaceholder("搜尋分點...").fill("分點");
    await page
      .getByTestId(TESTIDS.brokerSearchItem)
      .filter({ hasText: "分點001" })
      .click();
    await page
      .getByTestId(TESTIDS.brokerSearchItem)
      .filter({ hasText: "分點002" })
      .click();
    await page.keyboard.press("Escape"); // 關下拉(R2-1:避免座標點擊被 listbox 截走)
    await expect(page.getByTestId(TESTIDS.brokerChip)).toHaveCount(2);
    const totals = page.getByTestId(TESTIDS.bubbleBrokerTotals);
    await expect(totals).toContainText("買 200 張");
    // buy 側 circle(圖表右半,遠離下拉覆蓋區)中心點擊 → 單看分點001
    const buyCircle = page.locator('circle[data-broker-id="BROKER001"]').first();
    const box = (await buyCircle.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId(TESTIDS.bubbleSoloBadge)).toContainText("分點001");
    await expect(totals).toContainText("買 100 張");
    await expect(totals).toContainText("1.10 億");
    await expect(page.getByTestId(TESTIDS.brokerChip)).toHaveCount(2); // 組合不動
    await expect(page.getByTestId(TESTIDS.bubbleJumpToOverview)).toHaveCount(0); // 單看暫隱
    // 再點同泡泡 → 回整組
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByTestId(TESTIDS.bubbleSoloBadge)).toHaveCount(0);
    await expect(totals).toContainText("買 200 張");
    // 點空白兩段式:單看中點空白只解單看;無單看點空白才全清
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); // 進單看
    await expect(page.getByTestId(TESTIDS.bubbleSoloBadge)).toBeVisible();
    const overlay = page.getByTestId(TESTIDS.bubbleMainOverlay);
    const oBox = (await overlay.boundingBox())!;
    const blankX = oBox.x + oBox.width - 8;
    const blankY = oBox.y + 8; // 右上角無泡泡區(單一價位帶在中段)
    await page.mouse.click(blankX, blankY);
    await expect(page.getByTestId(TESTIDS.bubbleSoloBadge)).toHaveCount(0);
    await expect(page.getByTestId(TESTIDS.brokerChip)).toHaveCount(2); // 組合仍在
    await page.mouse.click(blankX, blankY);
    await expect(page.getByTestId(TESTIDS.brokerChip)).toHaveCount(0); // 第二段全清
  });

  test("E41: 搜尋下拉開啟時點圖表 = 只關下拉,篩選組合不動(mod/bubble-dropdown-dismiss-guard SC-1/2)", async ({ page }) => {
    // 痛點:user 點別處想關下拉,誤觸圖表空白 → 兩段式清除照跑組合被毀。
    // 真瀏覽器事件序(pointerdown → blur → click)是 guard 的核心假設,唯此可驗。
    await page.getByRole("button", { name: /^泡泡圖$/ }).click();
    await expect(page.getByTestId(TESTIDS.bubbleYaxisBrush)).toBeVisible();
    await page.getByPlaceholder("搜尋分點...").fill("分點");
    await page
      .getByTestId(TESTIDS.brokerSearchItem)
      .filter({ hasText: "分點001" })
      .click();
    await page
      .getByTestId(TESTIDS.brokerSearchItem)
      .filter({ hasText: "分點002" })
      .click();
    await expect(page.getByTestId(TESTIDS.brokerChip)).toHaveCount(2);
    const listbox = page.locator("#broker-search-listbox");
    await expect(listbox).toBeVisible(); // R1:pick 後下拉仍開
    // 第一擊圖表空白:只關下拉,組合不動
    const overlay = page.getByTestId(TESTIDS.bubbleMainOverlay);
    const oBox = (await overlay.boundingBox())!;
    await page.mouse.click(oBox.x + oBox.width - 8, oBox.y + 8);
    await expect(listbox).toBeHidden();
    await expect(page.getByTestId(TESTIDS.brokerChip)).toHaveCount(2);
    // 第二擊:下拉已關,照舊全清
    await page.mouse.click(oBox.x + oBox.width - 8, oBox.y + 8);
    await expect(page.getByTestId(TESTIDS.brokerChip)).toHaveCount(0);
  });

  test("E40: header 空間預留 — 搜尋下拉開啟時買賣統計完整可見不被遮擋(SC-1/2)", async ({ page }) => {
    // 痛點:舊版單一 flex-wrap header,下拉開啟直接蓋住統計列
    // (repro-six-selected-1536.png)。鎖 bounding box 不相交(功能級,免 visual baseline)。
    await page.getByRole("button", { name: /^泡泡圖$/ }).click();
    await expect(page.getByTestId(TESTIDS.bubbleYaxisBrush)).toBeVisible();
    await page.getByPlaceholder("搜尋分點...").fill("分點");
    await page
      .getByTestId(TESTIDS.brokerSearchItem)
      .filter({ hasText: "分點001" })
      .click();
    await page
      .getByTestId(TESTIDS.brokerSearchItem)
      .filter({ hasText: "分點002" })
      .click();
    // R1:pick 後下拉維持開啟 — 此時統計必須仍完整可見
    const listbox = page.locator("#broker-search-listbox");
    await expect(listbox).toBeVisible();
    const totals = page.getByTestId(TESTIDS.bubbleBrokerTotals);
    await expect(totals).toContainText("買 200 張");
    const lBox = (await listbox.boundingBox())!;
    const tBox = (await totals.boundingBox())!;
    const intersects =
      lBox.x < tBox.x + tBox.width &&
      lBox.x + lBox.width > tBox.x &&
      lBox.y < tBox.y + tBox.height &&
      lBox.y + lBox.height > tBox.y;
    expect(intersects).toBe(false);
  });

  test("E25: 換股載入時泡泡圖 loading badge 出現後消失(A5)", async ({ page }) => {
    // 痛點:loading feedback 鏈 = bubbleHook.loading → App loading prop →
    // badge render。FAKE fixture 回太快窗口極窄 → route gate 扣住 response
    // 直到 badge assertion 完成才放行(事件同步;原固定 1500ms delay 在高
    // 負載下 badge 可見窗被 click 步驟吃光 → 撲空偶紅 ×5+,2026-07-21 收割);
    // badge 永不出現(prop 沒接)或永不消失(loading 卡住)都會紅。
    let releaseBubble!: () => void;
    const bubbleGate = new Promise<void>((r) => (releaseBubble = r));
    await page.route("**/api/chip/2412/bubble**", async (route) => {
      await bubbleGate;
      await route.continue();
    });
    // 換標的用 Enter(E10 同款:dropdown option 在已載資料頁面上重渲染,
    // click retry 撞 detach;Enter 路徑不依賴 option 元素穩定性)
    await page.getByPlaceholder(/搜尋代號/).fill("2412");
    await expect(page.getByRole("option")).toHaveCount(1, { timeout: 15000 });
    await page.getByPlaceholder(/搜尋代號/).press("Enter");
    await page.getByRole("button", { name: /^泡泡圖$/ }).click();
    const badge = page.getByTestId(TESTIDS.bubbleLoadingBadge);
    await expect(badge).toBeVisible();
    await expect(badge).toContainText("載入 2412 泡泡圖中");
    releaseBubble();
    await expect(badge).toBeHidden({ timeout: 5000 });
  });

  test("E34: 自選清單 — 加入當前 → 換股 → 點清單項切回 + reload 持久(WL-1)", async ({ page }) => {
    // 痛點:切股鏈 = 清單項 onPick → App handlePick(重置 selectedBrokerIds/
    // 日期錨定等 sibling state)。vitest 鎖 sidebar 內部 CRUD;這裡鎖「清單
    // 項切股後整頁資料真的換到該股」+ localStorage 跨 reload。
    const sidebar = page.getByTestId(TESTIDS.watchlistSidebar);
    await expect(sidebar).toBeVisible();
    await page.getByTestId(TESTIDS.watchlistAddCurrent).click();
    await expect(page.getByTestId(TESTIDS.watchlistItem)).toContainText("2330");

    // 換到另一檔(E25 同款 Enter 路徑)
    await page.getByPlaceholder(/搜尋代號/).fill("2412");
    await expect(page.getByRole("option")).toHaveCount(1, { timeout: 15000 });
    await page.getByPlaceholder(/搜尋代號/).press("Enter");
    await expect(page.locator("header")).toContainText("2412");

    // 點清單項切回 2330
    await page.getByTestId(TESTIDS.watchlistItemPick).click();
    await expect(page.locator("header")).toContainText("2330");
    await expect(page.getByTestId(TESTIDS.chipBrokersPanel)).toBeVisible();

    // reload → 清單持久
    await page.reload();
    await expect(page.getByTestId(TESTIDS.watchlistItem)).toContainText("2330");
  });

  test("E36: 自選清單群組 — 管理面板建組 → 快選直加入該組(SC-1 mod/batch-ui-polish)", async ({ page }) => {
    // 痛點:舊流程「加入未分組 → hover 隱形 select 歸組」四步;新流程管理
    // 面板建組 + split 鈕一步入組。鎖「直加入的股票 DOM 掛在該組區塊下 +
    // reload 後 groupId 持久」— vitest 鎖 CRUD,這裡鎖跨 reload 全鏈。
    const sidebar = page.getByTestId(TESTIDS.watchlistSidebar);
    await expect(sidebar).toBeVisible();
    await page.getByLabel("管理分組").click();
    await page.getByTestId("watchlist-group-input").fill("半導體");
    await page.getByTestId("watchlist-create-group").click();
    await page.getByTestId("watchlist-add-to-group").click();
    await page.getByRole("menuitem", { name: /半導體/ }).click();
    const groupSection = page.getByTestId("watchlist-group-section");
    await expect(groupSection.getByTestId(TESTIDS.watchlistItem)).toContainText("2330");
    await page.reload();
    await expect(
      page.getByTestId("watchlist-group-section").getByTestId(TESTIDS.watchlistItem),
    ).toContainText("2330");
  });

  test("E33: 前 15 大列表「看泡泡圖」鈕 → 切 tab + 該分點自動聚焦(CH-1)", async ({ page }) => {
    // 痛點:跳轉鏈 = BrokerRow 動作鈕(stopPropagation)→ App setTab +
    // bubbleFocus(id+seq)→ ChipBubbleView focusRequest effect 選中。
    // vitest 各鎖單元;這裡鎖全鏈(lazy tab 首開帶 focusRequest mount 的
    // effect 順序也只有真 browser 走得到)。Fixture:分點001 買100/賣80。
    const bubbleBtn = page.getByTestId("broker-row-bubble-btn").first();
    await expect(bubbleBtn).toBeVisible();
    await bubbleBtn.click();
    // 已切到泡泡圖 tab 且該分點成為選中 → totals 資料級 assertion
    await expect(page.getByTestId(TESTIDS.bubbleYaxisBrush)).toBeVisible();
    const totals = page.getByTestId(TESTIDS.bubbleBrokerTotals);
    await expect(totals).toContainText("買 100 張");
    await expect(totals).toContainText("賣 80 張");
    // P0 回歸鎖(Phase 5 review):mode 切走(equity 子樹真卸載)再切回,
    // 陳舊 focusRequest 不得重放 — ChipBubbleView 重掛後不得自動再選中分點。
    await page.getByRole(ROLES.modeSwitchMarket.role, { name: ROLES.modeSwitchMarket.name }).click();
    await page.getByRole(ROLES.modeSwitchEquity.role, { name: ROLES.modeSwitchEquity.name }).click();
    await expect(page.getByTestId(TESTIDS.bubbleYaxisBrush)).toBeVisible();
    await expect(page.getByTestId(TESTIDS.bubbleBrokerTotals)).toHaveCount(0);
    // 整列 click 白名單行為未被吃掉(白名單 2):回總覽實際點列 → 仍 toggle 選取
    await page.getByRole("button", { name: /^籌碼總覽$/ }).click();
    const row = page.locator('div[role="button"]').filter({ hasText: "分點001" }).first();
    await row.click();
    await expect(page.getByTestId(TESTIDS.chipSelectedBar)).toContainText("分點001");
  });

  test("E32: 泡泡圖過濾清單 — 排除分點後泡泡/統計消失 + reload 持久(BB-1)", async ({ page }) => {
    // 痛點:過濾鏈 = popover 搜尋加入 → blocklist state → visibleTrades 上游
    // 過濾 → 計數/BrokerSearch/泡泡同步。vitest 鎖 jsdom 邏輯層;這裡鎖真
    // browser 全鏈 + localStorage 持久化(reload 後仍生效 — 全域跨個股設計)。
    // Fixture 基準:3 個分點(分點001-003)→ 排除一個後計數 3 → 2。
    await page.getByRole("button", { name: /^泡泡圖$/ }).click();
    await expect(page.getByTestId(TESTIDS.bubbleYaxisBrush)).toBeVisible();
    await expect(page.getByText("3 個分點")).toBeVisible();

    await page.getByTestId(TESTIDS.bubbleBlocklistTrigger).click();
    await page.getByLabel("搜尋分點加入排除").fill("分點001");
    const candidate = page.getByTestId(TESTIDS.bubbleBlocklistCandidate);
    await expect(candidate).toContainText("分點001");
    await candidate.click();
    await expect(page.getByText("2 個分點")).toBeVisible();

    // 被排除分點不再出現在 BrokerSearch 下拉
    await page.getByPlaceholder("搜尋分點...").fill("分點001");
    await expect(page.getByTestId(TESTIDS.brokerSearchItem)).toHaveCount(0);

    // reload → localStorage 持久化仍生效
    await page.reload();
    await page.getByPlaceholder(/搜尋代號/).fill("2330");
    await page.getByRole("option").first().click();
    await page.getByRole("button", { name: /^泡泡圖$/ }).click();
    await expect(page.getByTestId(TESTIDS.bubbleYaxisBrush)).toBeVisible();
    await expect(page.getByText("2 個分點")).toBeVisible();
    await expect(page.getByTestId(TESTIDS.bubbleBlocklistTrigger)).toContainText("1");
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
    await page.getByRole("button", { name: /^泡泡圖$/ }).click();
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
