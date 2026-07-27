# Brainstorm — 泡泡圖多選分點(bubble-multi-broker)

## 分流判定記錄

模糊 idea 路(判準條件 1 未中:user 原敘述「同時看多個分點」只有目標,未指名做法)。
方向性抉擇已由 user 於本 session AskUserQuestion 拍板:**多選高亮 + 明細合併**
(候選:分欄對比 / 僅圖面標記,皆被 user 排除)。剩餘決策皆為實作級,依 /auto 契約
標 `[auto-default]` 推進。

## 目標

泡泡圖(equity mode「泡泡圖」tab,`ChipBubbleView`)目前一次只能選一個分點
(`selectedBrokerId: string | null`),選中後圖面只剩該分點泡泡、右側明細過濾為該分點。
改為可**同時選取多個分點**:圖面同時顯示所有選中分點的泡泡並以顏色區分,右側明細
合併列出(每列標示所屬分點),統計為合併值。

## 現況事實(自查)

- 選取鏈:`BrokerSearch`(name key)/ 泡泡點擊 / TradeList 列點擊 → `selectedBrokerId`。
- `BubbleChartSvg.selectedBroker`(name)= filter 模式:選中時只 render 該分點 trades,threshold 0,軸不重排(F11)。
- `buildTradeRows(trades, selectedBroker, ...)` / `computeBrokerTotals(trades, brokerId)` 皆單值。
- `App.tsx handleJumpToOverview` 已接 `string | string[]`(C7 預留)→ **App.tsx 不需改動**。
- `focusRequest`(籌碼總覽「看泡泡圖」)單分點聚焦;blocklist 加入時清除同 id 選取。
- C11:已選 broker 時 brushRange 退為視覺參考(不預過濾)。

## 拍板方案

選取 state 改為有序集合 `Array<{ id, name, colorIdx }>`(上限 6),三個入口
(搜尋下拉 / 點泡泡 / 點明細列)一律 toggle 語意:未選 → 加選;已選 → 移除。

- **圖面**:N ≥ 1 時 render 所有選中分點 trades(threshold 0,filter 模式泛化);
  買賣 fill 維持紅買綠賣(專案 chip 慣例,方向資訊優先);N ≥ 2 時每分點泡泡
  加該分點**專屬色外框**(6 色 categorical palette)識別。N = 1 圖面與現行一致。
  [auto-default: fill 保留買賣色、以 stroke 色區分分點 | reason: 買賣紅綠是全 app
  chip 慣例,butterfly 佈局左右已編碼買賣側,外框色足以識別分點且對既有視覺零回歸]
- **Legend chips**:header 搜尋框旁,每個選中分點一枚 chip(專屬色圓點 + 顯示名 + ×),
  ≥ 2 枚時附「清除全部」。BrokerSearch 改純「搜尋即加選」(不再 echo 選中名、
  移除 input 內 × 清除鈕 — 清除職責移至 chips)。
  [auto-default: chips 取代 input echo | reason: echo 單值語意無法承載多選;chips 是
  多選 UI 通用樣式,單選時也一致]
- **明細**:`buildTradeRows` / `computeBrokerTotals` / priceAggs 過濾條件改「屬於選中集合」;
  明細列首加所屬分點專屬色圓點(N ≥ 2 時)。header 統計(買/賣張、買賣額)為合併值。
- **顏色配置**:colorIdx = 加選當下最小未占用 slot,移除不重配其他分點顏色
  (避免顏色跳動)。palette 值於 Phase 3 前讀 `dataviz` skill 定案。
  [auto-default: 最小未占用 slot 配色 | reason: 依 array index 配色會在移除時整組換色]
- **focusRequest**:取代整組選取為該單一分點(顯式聚焦意圖優先)。
  [auto-default: replace 不 append | reason: 聚焦語意 = 「看這個」,沿用單選心智模型]
- **上限 6**:選滿再加選 → 不加入,header 顯短提示「最多同時選 6 個分點」。
  [auto-default: 上限 6 | reason: categorical palette 可辨識度上限;>6 明細也失去對比意義]
- **C11 泛化**:`selectedBrokerIds.length > 0` 時 brush range 退視覺參考(同現行單選)。
- **跳籌碼總覽**:N = 1 維持現行文案;N ≥ 2 改「查看 N 個分點於籌碼總覽 →」,
  傳 id array(契約已預留)。

## SC(成功條件)

- **SC-1 多選選取**:搜尋下拉點選、點泡泡、點右側明細列三入口皆可 toggle 選取;
  可同時選取至多 6 個分點。[amendment 2026-07-27: design review R2 — 圖面為 filter
  模式,N ≥ 1 後泡泡 / 明細列入口畫面上只剩選中分點、實際僅能移除;加選第 2 個以上
  的入口 = 搜尋下拉(永遠列全體)。驗收依此:泡泡 / 列入口驗 N=0 加選 + N≥1 移除,
  搜尋入口驗連續加選。]
  驗證:`frontend` vitest `ChipBubbleView.test.tsx` 多選 toggle cases;e2e E#(SC-7)。
  驗證窗口:anytime(FAKE fixture)。
- **SC-2 泡泡圖高亮**:選取 ≥ 1 分點時圖面只顯示選中分點的泡泡(sub-threshold 也顯示);
  選取 ≥ 2 時,畫面上每個分點的泡泡外框為該分點專屬色(6 色 palette,同分點同色),
  買賣 fill 維持現行紅買綠賣。畫面可指認:兩分點各自泡泡外框色 ≠ 彼此,且與 legend
  chip 圓點同色。
  驗證:vitest `chip-bubble-svg.test.tsx` — 兩選中分點 bubbles 的 stroke 分別等於
  palette[0] / palette[1] 的正向 assertion。驗證窗口:anytime。
- **SC-3 Legend chips**:header 搜尋框右側,每個選中分點出現一枚 chip
  (專屬色圓點 + 分點顯示名〔walk `lib/broker-name.ts` formatter〕+ × 鈕);點 × 移除
  該分點;≥ 2 枚時出現「清除全部」鈕,點擊清空選取。
  驗證:vitest chips render / 移除 / 清除全部 cases。驗證窗口:anytime。
- **SC-4 明細合併**:選取 ≥ 2 分點時,右側買賣明細包含所有選中分點的列
  (分點欄顯示各列所屬分點名,列首帶專屬色圓點);header 買/賣張數與買賣額
  = 所有選中分點加總;價位長條圖 = 選中分點合併資料。
  驗證:vitest `chip-data.test.ts`(buildTradeRows / computeBrokerTotals 集合版)
  + `ChipBubbleView.test.tsx` 合併統計 assertion。驗證窗口:anytime。
- **SC-5 單選回歸**:僅選 1 個分點時:圖面只顯該分點泡泡且 fill/stroke 與現行一致
  (無專屬色外框)、header 顯「查看〈該分點〉於籌碼總覽 →」、統計為該分點值;
  換股票時選取清空;brush C11 行為不變。
  驗證:既有 vitest 全綠(該變 assertion 事前標記)+ e2e 既有 E# 泡泡圖 cases 綠。
  驗證窗口:anytime。
- **SC-6 聚焦與排除互動**:籌碼總覽「看泡泡圖」聚焦 → 選取整組被取代為該分點
  (含既有 blocklist 自動移除 + 無成交 badge 行為);把選中分點加入排除清單 →
  自選取組移除,其餘選中分點保留。
  驗證:vitest focusRequest / blocklist cases。驗證窗口:anytime。
- **SC-7 e2e**:`e2e/specs/equity.spec.ts` 新 E#:FAKE fixture 下選取兩個分點 →
  頁面出現 2 枚 legend chip、右側明細同時含兩分點名稱列、header 統計為兩分點合併值
  (資料級 assertion,非 visibility-only)。
  驗證:`e2e` `npx playwright test specs/equity.spec.ts`。驗證窗口:anytime。

## Edge cases(≥ 3)

1. **選滿 6 個再加選** → 不加入、選取不變,header 顯提示「最多同時選 6 個分點」
   (下次選取動作或換股時清除提示)。
2. **選中分點因 blocklist / refetch 自 visibleTrades 消失** → chip 仍顯示
   (state 存 `{id, name}`,名稱不依賴 trades lookup);blocklist 加入路徑主動自組移除。
3. **移除中間一枚 chip** → 其餘分點顏色不變(colorIdx 固定);新加選者拿最小空 slot
   (可能回收剛釋出的顏色)。
4. **focusRequest 聚焦的分點當日無成交** → 現行 badge 行為保留(單選情境);
   取代語意保證組內只剩該分點,不與多選狀態疊加。
5. **Mobile**:tap 泡泡 toggle 加選並開 sheet;sheet 標題 N ≥ 2 顯「N 個分點」。

## Out of scope

- 跨股票 / 跨 session 記住選取(維持換股即清)。
- 未選取分點「淡化共顯」模式(維持 filter 模式:只顯選中)。
- 明細分欄 / 分 tab 對比(user 已拍板合併)。
- K 線 overlay(籌碼總覽 selectedBrokerIds)行為變更 — 契約沿用,不動 App.tsx。
- 泡泡圖顏色系統重構(只加 per-broker stroke,不動 buy/sell fill 常數)。

## e2e 歸屬(e2e-conventions 判準表)

equity mode UI / flow → `e2e/specs/equity.spec.ts` 新增 E#(SC-7);
FAKE_FINMIND fixture 既有 bubble 資料可用,不需新 fixture;非 layout 大改,不動 visual.spec。

## 執行約束(跨輪 / memory)

- UI 實作開工前呼叫 `frontend-design` + `bencium-controlled-ux-designer`(user 2026-07-07 指示)。
- 寫 chart 顏色前讀 `dataviz` skill(categorical palette)。
- 動 frontend 元件前讀 `frontend-conventions`;寫 vitest 前讀 `frontend-testing`。
- 分點名稱顯示一律走 `lib/broker-name.ts`(專案 CLAUDE.md §4)。
- 前輪 bubble-chip-ux 契約:C2/C7 `onJumpToOverview(string | string[])` 分支皆有 caller,
  不得破壞;F11 axes-stable(選取切換不重排軸)原則沿用。

## Scope 分流

**L**(動 4 個 source 檔 + 4 個測試檔 + e2e spec ≥ 5 檔;純 frontend、無鑑權 / hot path
/ 對外 API 風險面)。M/L 輪數統一,L 的 /auto 慎用點(Phase 0 對齊)已由 user
AskUserQuestion 拍板完成。
