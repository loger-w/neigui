# Implementation PLAN — bubble-multi-broker(condensed)

> 依 design.md v2。TDD:每檔紅測試先行。實作前讀 `frontend-conventions` /
> `frontend-testing` / `dataviz`(palette)+ 呼叫 frontend-design / bencium(UI 節)。

## 1. frontend/src/lib/chip-data.ts(+ chip-data.test.ts)

- `computeBrokerTotals(trades, brokerIds: ReadonlySet<string>)`:第二參數單值 → 集合;
  空集合回全零;過濾 `brokerIds.has(t.broker_id)`。
- `buildTradeRows(trades, brokerIds: ReadonlySet<string>, maxRows, buySort?, sellSort?)`:
  同上;空集合 = 不過濾(現行 null 分支語意)。
- 紅測試:空集合全零 / 不過濾;單 id(對照現值);雙 id 合併(手算 fixture);
  未知 id 混入僅計已知。**該變 assertion**:既有單值呼叫測試改集合(事前標記)。
- 對應 SC-4、SC-5。

## 2. frontend/src/lib/chip-bubble-svg.tsx(+ chip-bubble-svg.test.tsx)

- 新 export:`interface BubbleSelectedBroker { id; name; colorIdx }`、
  `const BROKER_PALETTE: readonly string[]`(6 色,依 dataviz categorical 定值)。
- Props:`selectedBroker?: string | null` → `selectedBrokers?: readonly BubbleSelectedBroker[]`。
  filter / threshold / F2 軸 fallback 全改集合(`ids.has(t.broker_id)`,
  `length > 0` 判定);F11 axes-stable 不動。
- 外框:`length >= 2` → `stroke = BROKER_PALETTE[colorIdx]`、strokeWidth 2;
  `length <= 1` → 現行 COLOR stroke / width。空狀態 hint:1 個維持
  `${name} 今日無顯著成交量`;≥2 →「選中分點今日無顯著成交量」。
- 紅測試:2 選中 → stroke = PALETTE[0]/[1] 正向 assertion;1 選中 → stroke 現行值
  (SC-5 鎖);hint 雙分支。**該變 assertion**:舊 selectedBroker prop 測試改新 prop。
- 對應 SC-2、SC-5。

## 3. frontend/src/components/BrokerSearch.tsx

- Props → `{ trades, selectedIds: ReadonlySet<string>, onPick(id: string, name: string) }`;
  移除 value echo 效果 / input × 鈕。
- [phase-3 補註] **聚合與選取契約改以 broker_id 為 key**(收割 next-time.md deferred 項,
  觸發條件「ChipBubbleView selection 域重構時」本輪命中;同名不同 id 分點實測存在):
  `aggregates` Map key 由 name 改 broker_id,item key / 已選標記同步;ChipBubbleView
  搜尋入口不再需要 name→id lookup。done 後刪 next-time.md 該條。
- `pick()`:呼叫 onPick,**不** setOpen(false)、不清 query;下拉 item
  `onMouseDown={(e) => { e.preventDefault(); pick(b.broker); }}`(R1)。
- 已選列標記(R6 修):下拉容器 `role="listbox"`、item `role="option"` +
  `aria-selected`(對齊 E37 combobox a11y 前例)+ ✓ 前綴 + 高亮 class;
  Enter 對 active 列 toggle。
- **既有 `BrokerSearch.test.tsx`(R1 修:確實存在)**:value echo(L25-28)/
  × 清除鈕 / onChange 相關 case 全數**事前標為該變 assertion** — 改寫為新 props
  (`selectedNames` / `onPick`)的單元測試:placeholder、篩選、onPick 呼叫、
  pick 後下拉保持開啟、已選列 aria-selected。
- 對應 SC-1、SC-3。

## 4. frontend/src/components/ChipBubbleView.tsx(+ ChipBubbleView.test.tsx)

- State:`selected: SelectedBroker[]`(≤6)+ `limitNotice: boolean` 取代
  `selectedBrokerId`;`toggleBroker(id, name)` 依 design §1(最小空 colorIdx slot);
  所有改選取路徑清 limitNotice(R4)。
- Derived:`selectedIds` / `selectedNames`(自 state,R5)/ `colorByName`;
  `rangeActiveForFilter = brush && selected.length === 0`(C11);priceAggs 過濾改
  selectedIds;`computeBrokerTotals(rangeTrades, selectedIds)`;
  `buildTradeRows(rangeTrades, selectedIds, ...)`。
- Header:chips 區(`broker-chip` testid,色圓點 + formatBrokerName + × 移除)、
  ≥2 附「清除全部」(`broker-chips-clear`)、limitNotice `role="status"` 文案
  「最多同時選 6 個分點」;跳總覽鈕 N=1 現行文案 / N≥2「查看 N 個分點於籌碼總覽 →」
  傳 id 陣列;fallback「已篩選 N 個分點」。
- focusRequest → `setSelected([{id, name, colorIdx: 0}])`(取代);handleBlockAdd →
  filter 移除該 id;symbol reset 清 selected + limitNotice;mobile effect
  `selected.length > 0` 開 sheet,歸 0 不自動關;sheet 標題三分支。
- 無成交 badge 條件(design §7 轉錄):`focusedBroker !== null &&
  selected.length === 1 && selected[0].id === focusedBroker.id && trades 無該 id`
  — **必須 length === 1 嚴格判**,多選含聚焦分點時 badge 不現。
- DetailPanel / TradeList props:`selectedNames` + `colorFor(name)`;列首圓點
  `row-broker-dot`(N≥2)。
- 紅測試:三入口 toggle、上限 6 + notice + 各清除路徑、chips 移除/清除全部、
  合併統計數字、focusRequest 取代、blocklist 移除保留其餘、sheet 標題、
  N=1 回歸(現行 case 保綠)。
  - **泡泡 / 明細列入口的測法(R2 修)**:jsdom 下兩入口點不到(virtualized rows +
    零尺寸 SVG,既有測試檔 L186-188 自述)— 以 mock BubbleChartSvg / TradeList
    抓取 `onBubbleClick` / `onSelect` prop 直接呼叫做 handler 級測試
    (N=0 加選 + N≥1 移除);真點擊路徑由 e2e E# 覆蓋(SC-1 驗證註記)。
  - **消失分點不失效(R3 修,鎖 design R5)**:selected 含 id 不存在於 trades 的
    分點 → chip 仍 render 該 name、統計 / active 態不 crash。
  - **配色不變式(R4 修)**:選 A/B/C(idx 0/1/2)→ 移除 B → A/C chip 圓點
    inline style 色不變 → 加選 D → D 圓點 = PALETTE[1](最小空 slot 回收)。
  - **badge 嚴格單選(R5 修)**:多選含 focusedBroker 時無成交 badge 不現。
  **該變 assertion**:search echo / input × 鈕舊測試(本檔整合層 + BrokerSearch.test.tsx)。
- 對應 SC-1、SC-3、SC-4、SC-5、SC-6。

## 5. e2e/specs/equity.spec.ts

- 新 E#(接現有編號):FAKE fixture 下進泡泡圖 tab → 搜尋加選分點 A →
  **下拉仍開啟**直接點分點 B(R1 真瀏覽器 assertion)→ 斷言:2 枚 `broker-chip`;
  右側明細同時含 A、B 名稱列;header 統計 = fixture 手算合併值(資料級)。
- 痛點註解連回 SC-7 / R1。selector 對 page snapshot 校齊。
- **既有泡泡圖 e2e audit(R7 修)**:實作後跑既有走「fill → brokerSearchItem.click()」
  流程的 cases(E23/E24 等,grep `broker-search-item` / bubble 相關 E#)確認綠;
  「pick 後下拉常開」會蓋圖面區,既有 case 後續步驟被遮擋時,步驟先 Escape 關閉
  下拉(標為該變)。
- 對應 SC-7、SC-1。

## 不動面

App.tsx(`handleJumpToOverview` 已接 string[])、broker-name.ts、bubble-blocklist.ts、
COLOR 買賣 fill 常數、K 線 overlay 契約。
