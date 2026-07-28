# current-state — 泡泡圖 UI/UX polish(mod/bubble-chart-ux-polish)

日期:2026-07-28。Baseline:vitest 99 檔 1007 tests 全綠(改動前)。

## 問題重現(截圖在本目錄)

- `repro-baseline.png`:2330 載入後初始狀態(2560px)。
- `repro-search-open.png`:搜尋「摩根」下拉開啟 — 下拉本身是 absolute 疊層,不推擠。
- `repro-six-selected-wide.png`:選滿 6 chip(2560px)— 同列仍擠得下,但**搜尋框被壓窄**
  (flex shrink),下拉寬度 = 輸入框寬度跟著變窄。
- `repro-six-selected-1536.png`:1536px + 6 chip + 下拉開啟 — **問題 1 完整重現**:
  - header flex-wrap 換行成 2 行,買/賣統計(`bubble-broker-totals`)掉到第二行;
  - 開啟的搜尋下拉(absolute z-50)直接**蓋住統計列**,「買 6,958 張」只剩「8 張」露出;
  - 第 5、6 個 chip 也被下拉蓋住。

## 現況結構(ChipBubbleView.tsx)

### Header(L383):單一 `flex flex-wrap` 容器,所有東西共擠
```
<div class="shrink-0 min-h-10 px-3 py-1 ... flex flex-wrap items-center gap-x-3 gap-y-1">
  BrokerSearch(wrapper: relative w-full max-w-[360px] — 可 shrink)
  {chips ×N}(selected.map)
  清除全部(N≥2)
  limitNotice
  查看 N 個分點於籌碼總覽 →(selected>0)/ 今日共 X 個分點(selected=0)
  bubble-broker-totals 買/賣/買額/賣額(僅 selected>0 時 render)
  blockRemovalNotice
  <div class="ml-auto ...">過濾清單 | 輸入區間 | (明細 mobile) | ?</div>
</div>
```
- 統計列「僅 selected>0 時 render」→ 出現/消失本身就造成 layout jump。
- BrokerSearch 下拉 `absolute top-full left-0 right-0 z-50` — 寬度綁 wrapper,
  wrapper 被 shrink 時下拉一起窄;開啟時蓋住換行後掉到下方的統計。

### 選取互動(問題 2)
- `toggleBroker`(L122):已選 → 移除;未選 → 加選(滿 6 拒絕)。三入口共用:
  1. BrokerSearch onPick
  2. `handleBubbleClick`(L281):泡泡點擊 — `broker === null`(點空白)→ **全清**
     (selected + brush + manualInput);有 brokerId → toggle。
  3. DetailPanel/TradeList row onClick(L987)→ 同 `handleBubbleClick` → toggle。
- Legend chip ×(L410)→ toggle(移除);清除全部鈕(N≥2)→ 全清選取。
- **無任何「單看一個分點的個別買賣超」路徑**:多選時 `brokerTotals`(L243)是
  **整組選中集合的加總**;hover tooltip 只顯示單一泡泡(該分點×該價位)的買或賣張數,
  不是該分點當日總買賣超。
- 使用者心智模型衝突點:多選 = 花時間建立的「篩選組合」;點泡泡想「看看這個」卻觸發
  toggle → 已選的被移除、未選的被加進組合(改變篩選),點空白直接全滅。

## 下游資料流(改動影響面)

`selected` state 驅動:
- `selectedIds` → `brokerTotals`(統計列)、`priceAggs`(右欄 price bar)、
  `buildTradeRows`(右欄買賣列表 filter)、TradeList row active 態、BubbleChartSvg
  `selectedBrokers`(泡泡 highlight + 外框色)
- `colorById`(N≥2 配色)→ chips 圓點、TradeList row 圓點、泡泡外框
- `rangeActiveForFilter = brushRange && selected.length===0`(C11:有選取時 brush 退為視覺參考)
- mobile:`selected.length>0` → 自動開 sheet

## Caller map

- `ChipBubbleView` 唯一 caller:`App.tsx:533`(lazy,bubble tab)。props:bubbleData/
  closePrice/symbol/intradayPoints/onJumpToOverview/loading/focusRequest。
- `BrokerSearch` 唯一 caller:`ChipBubbleView.tsx:384`。
- `BubbleChartSvg.onBubbleClick` 唯一掛載點:`ChipBubbleView.tsx:541`;svg 內部
  `chip-bubble-svg.tsx:346` 發出 `(broker|null, brokerId?)`。
- 動態用法 grep:無 template string / reflection 引用這些元件名(lazy import 之外)。

## 現況 vs 目標

| 面向 | 現況 | 目標 | backward compat |
|---|---|---|---|
| Header 空間 | 搜尋框/chips/統計共擠一個 flex-wrap,互相推擠;下拉蓋統計 | 搜尋區空間預留固定,搜尋/加選不推擠統計列 | 純 layout,無 API 變更 |
| 統計列 | selected>0 才 render,位置隨 wrap 漂移 | 位置穩定(空間常駐或固定行) | data-testid 沿用 |
| 點泡泡(多選中) | toggle(已選→移除 = 破壞篩選組合) | 可「單看該分點買賣超」而不破壞選取 | toggle 語意是否保留待 Phase 2 拍板 |
| 右欄明細列點擊 | 同 toggle | 同上 | 同上 |
| 點空白 | 全清 selected+brush | 待 Phase 2(可能保留) | — |

## 既有測試覆蓋(改動前全綠)

- `ChipBubbleView.test.tsx`:sort headers、jump-to-overview、chips、limit、blocklist、
  focusRequest、brush parked 等(BrokerSearch 輸入路徑選取)。
- `BrokerSearch.test.tsx`:搜尋/加選/鍵盤/highlight/dropdown 行為。
- `chip-bubble-svg.test.tsx`:svg click payload/顏色。
- e2e:`e2e/specs/` 泡泡圖相關 spec(Phase 2 讀 e2e-conventions 判歸屬)。
