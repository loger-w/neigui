# change-spec.md — 泡泡圖 + 籌碼總覽 UX 改善

**Date**: 2026-07-02
**Slug**: bubble-chip-ux
**Type**: /mod
**Scope**: frontend 8 檔 + 1 個 lib helper。零 backend。

---

## 1. 商業動機

- **泡泡圖**:增加 Y 軸 brush 選價位 / 選分點後跳籌碼總覽 / 顯示分點總買賣 / 搜尋後 loading feedback
- **籌碼總覽**:消除選擇分點造成的 CLS(chip bar / K 線下 broker row);row 全區可點

## 2. 8 個 commit 序列(依 /mod Phase 4「🔵 → 🔴 → 🟢」)

| # | 序號 | 類別 | 標題 | 動 file 主體 |
|---|---|---|---|---|
| 1 | C1 | 🔵 | A4:bubble selection state name → broker_id refactor | `ChipBubbleView.tsx` |
| 2 | C2 | 🔴 | A2:「已篩選 1 個分點」 → 「查看於籌碼總覽」button + App handler | `ChipBubbleView.tsx`、`App.tsx` |
| 3 | C3 | 🔴 | B2:ChipBrokersPanel chip bar 容器常駐 + placeholder | `ChipBrokersPanel.tsx` |
| 4 | C4 | 🔴 | B3:ChipKlineChart broker row 容器常駐 + grid 固定 6 subchart | `ChipKlineChart.tsx` |
| 5 | C5 | 🟢 | A5:ChipBubbleView 新增 loading badge | `ChipBubbleView.tsx`、`App.tsx` |
| 6 | C6 | 🟢 | A3:分點總買/賣張/金額顯示 + `computeBrokerTotals` helper | `chip-data.ts`、`ChipBubbleView.tsx` |
| 7 | C7 | 🟢 | A1:Y 軸 brush + summary + 篩選 button | `ChipBubbleView.tsx`、`chip-data.ts`(helper) |
| 8 | C8 | 🟢 | B1:ChipBrokersPanel 整 row 可點 | `ChipBrokersPanel.tsx` |

---

## 3. 逐 commit diff 級 spec

### C1 🔵 — bubble selection state name → broker_id refactor

**Files:** `frontend/src/components/ChipBubbleView.tsx`

**改動:**
- 內部 state `selectedBroker: string | null`(name)→ `selectedBrokerId: string | null`(broker_id)
- 新增 derived `selectedBrokerName = useMemo(() => bubbleData?.trades.find(t => t.broker_id === selectedBrokerId)?.broker ?? null, [bubbleData, selectedBrokerId])`
- **完整 downstream caller 清單(全部改傳 `selectedBrokerName`)**:
  - `<BrokerSearch value={selectedBrokerName} onChange={(name) => setSelectedBrokerId(name ? trades.find(t => t.broker === name)?.broker_id ?? null : null)} />` — BrokerSearch 保持 name 接口
  - `<BubbleChartSvg selectedBroker={selectedBrokerName} ... />`(L155)— svg 接 name 不動
  - `buildTradeRows(bubbleData.trades, selectedBrokerName, ...)`(L122)— helper 接 name 不動
  - **`<TradeList selectedBroker={selectedBrokerName} onSelect={handleBubbleClick} ... />`**(L178 + L186)— local TradeList 元件(L263-356)`selectedBroker === r.broker`(L339)active row highlight 依賴 name,若漏改高亮全失效
  - `priceAggs` useMemo(L103-114)filter 用 `t.broker === selectedBroker` → 改成 `t.broker === selectedBrokerName`
- `handleBubbleClick(broker: string | null)` 接 svg 傳來的 name → 內部 name → id 轉換:
```ts
const handleBubbleClick = useCallback((broker: string | null) => {
  if (broker === null) { setSelectedBrokerId(null); return; }
  const id = bubbleData?.trades.find(t => t.broker === broker)?.broker_id ?? null;
  setSelectedBrokerId((prev) => (prev === id ? null : id));
}, [bubbleData]);
```
- Header 顯示 `selectedBrokerName ? (<>已篩選 1 個分點</>) : ...` (C2 才改文字)
- `useEffect(() => setSelectedBrokerId(null), [symbol])` — reset on symbol change 語意保留

**測試預期:** 全綠不動
- `ChipBubbleView.test.tsx` 7 個 tests 全綠(它們測 sort header,不觸 selection;TradeList 高亮無獨立測試,靠手動 Phase 7 驗)
- `chip-bubble-svg.test.tsx` 全綠(svg 仍接 name)
- `BrokerSearch.test.tsx` 全綠(不動)

**Backward compat 風險:** 
- **R3**:同 broker name 對到多 broker_id 邊界。實務上 FinMind `securities_trader_id` 通常 1:1 對 name;若同 name 對到多 id,`trades.find` 取第一個。
- **R3 保護**:`chip-data.test.ts` 新增 unit test「buildTradeRows with same broker name across different broker_id」— assert 現有 name-based filter 行為(既有 code 就以 name filter,C1 不改此行為;此測試 lock 未來若改成 id-based filter 需自覺打破契約)。
- **Phase 7** 用 2330(數千 broker rows)真環境驗證 active row 高亮 + trade list 正確性。

---

### C2 🔴 — 「已篩選 X 個分點」→「查看於籌碼總覽」button + App handler

**Files:** `frontend/src/components/ChipBubbleView.tsx`、`frontend/src/App.tsx`

**改動:**

`ChipBubbleView.tsx`:
- Props 新增 `onJumpToOverview?: (brokerId: string) => void`
- Header L137-142 的 `{selectedBroker ? (<>已篩選 1 個分點</>) : (<>今日共 X 個分點</>)}` → 
```tsx
{selectedBrokerId && selectedBrokerName ? (
  onJumpToOverview ? (
    <button
      type="button"
      onClick={() => onJumpToOverview(selectedBrokerId)}
      data-testid="bubble-jump-to-overview"
      className="text-xs text-accent hover:text-ink underline underline-offset-2 cursor-pointer"
    >查看 {selectedBrokerName} 於籌碼總覽 →</button>
  ) : (
    <span className="text-xs text-ink-dim">
      已篩選 <span className="text-[#f0b429] font-medium">1</span> 個分點
    </span>
  )
) : (
  <span className="text-xs text-ink-dim">今日共 <span className="text-[#b794f4] font-medium">{uniqueBrokerCount}</span> 個分點</span>
)}
```
- Defensive:onJumpToOverview 若無 prop → fallback 舊 text(此路徑實務不會走,但避免 tests 硬綁 prop)

`App.tsx`:
- 新增 handler(**signature 一次寫對,C7 不再擴充**):
```ts
const handleJumpToOverview = useCallback((brokerIdOrIds: string | string[]) => {
  const ids = Array.isArray(brokerIdOrIds) ? brokerIdOrIds : [brokerIdOrIds];
  setTab("overview");
  setSelectedBrokerIds(new Set(ids));
}, []);
```
- L413 `<ChipBubbleView ...>` 加 `onJumpToOverview={handleJumpToOverview}`
- ChipBubbleView props signature `onJumpToOverview?: (brokerIdOrIds: string | string[]) => void`
- C2 只呼叫 single-id 分支;C7 brush 呼叫 array 分支。**C2 → C7 無 signature 破壞,可個別 revert**。

**新測試(TDD 紅先行):**
- `ChipBubbleView.test.tsx` 加 describe「A2 jump-to-overview button」:
  - 選中 broker → button 出現 + `data-testid="bubble-jump-to-overview"` + 文字含分點名
  - 點 button → `onJumpToOverview` 被呼叫,參數 = broker_id
  - 未選任何 broker → button 不出現(顯示「今日共 N 個分點」)
  - `onJumpToOverview` 未 pass 且有選 broker → 顯示 fallback 舊 text(defensive path)

**既有測試:** 全綠
- 7 個既有 ChipBubbleView test 都沒斷言 header 文字 → 綠

---

### C3 🔴 — ChipBrokersPanel chip bar 容器常駐 + placeholder

**Files:** `frontend/src/components/ChipBrokersPanel.tsx`

**改動:**
L318-360:
```tsx
{N > 0 && (
  <div className="px-3 py-2 border-b border-line bg-bg-deep/40 flex flex-wrap gap-1.5 items-center">
    <span className="text-xs text-ink-dim">已選 {N} 個分點:</span>
    ...
  </div>
)}
```
→
```tsx
<div
  data-testid="chip-selected-bar"
  className="px-3 py-2 border-b border-line bg-bg-deep/40 flex flex-wrap gap-1.5 items-center min-h-[36px]"
>
  {N === 0 ? (
    <span className="text-xs text-ink-dim italic">未選擇分點</span>
  ) : (
    <>
      {Array.from(selectedBrokerIds).map((bid) => {
        const name = idToName.get(bid) ?? bid;
        return (
          <span key={bid} ...>
            {name}
            <button ...>×</button>
          </span>
        );
      })}
      {N > 1 && (
        <button onClick={onClearAllBrokers} ...>清空</button>
      )}
    </>
  )}
</div>
```

**新測試:**
- `ChipBrokersPanel.test.tsx` 加 describe「B2 chip bar 常駐」:
  - 未選 → `[data-testid="chip-selected-bar"]` 存在 + 內含「未選擇分點」
  - 已選 1 → chip tag 顯示 broker name,不顯 placeholder
  - 已選 2+ → chip tags + 「清空」button

**既有測試:** 全綠
- 28 test 全用 `new Set()` → 舊行為「未選時 chip bar 不存在」→ 新行為「未選時 chip bar 存在但 placeholder」→ **既有 test 沒斷言 chip bar 不存在**(grep 已確認 R1)→ 綠

---

### C4 🔴 — ChipKlineChart broker row 容器常駐 + grid 固定 6 subchart

**Files:** `frontend/src/components/ChipKlineChart.tsx`

**改動:**
- L317-325 grid 分配 → 固定 6 subchart:
```tsx
const showBrokerData = selectedBrokerIds.size > 0;
const gap = 6;
const totalParts = 3.5 + 6;  // 固定 6 subchart
const klineH = Math.round((totalH - gap) * (3.5 / totalParts));
const subCount = 6;
const subH = Math.floor((totalH - gap - klineH) / subCount);
const lastSubH = totalH - gap - klineH - subH * (subCount - 1);
```
- 融資融券高度改回 `subH`(固定,不再膨脹到 lastSubH):L462-479
- **K 線本身高度變化說明**(白名單新增條目):
  - 舊未選:K 線 = 3.5 / 8.5 = 41.2% totalH
  - 舊已選:K 線 = 3.5 / 9.5 = 36.8% totalH
  - **新(全狀態)**:K 線 = 3.5 / 9.5 = 36.8% totalH → **未選狀態下 K 線縮 4.4%,已選狀態不變**
  - Trade-off 明列於 §Phase 2 白名單:接受 K 線在未選狀態下與已選狀態高度一致(消 CLS),代價是未選狀態下 K 線可見高度略降
- Broker row L480-501 從 `{showBrokerRow && (...)}` 拿掉條件 → 容器永遠 render:
```tsx
<div
  data-testid="chip-broker-row"
  className="border-t border-line/50 relative"
  style={{ height: lastSubH, minHeight: 0 }}
>
  {lastSubH > 0 && showBrokerData && (
    <BrokerAggBarSvg
      data={brokerAggSeries}
      width={w}
      height={lastSubH}
      label={`分點 (${selectedBrokerIds.size})`}
      hoverIndex={hoverIndex}
      selectedIndex={selectedIndex}
    />
  )}
  {lastSubH >= 24 && !showBrokerData && (
    <div className="h-full flex items-center justify-center text-xs text-ink-dim italic">
      未選擇分點
    </div>
  )}
  {showBrokerData && (
    <button ... onClick={onClearAllBrokers}>清除</button>
  )}
</div>
```

**新測試:**
- `ChipKlineChart.test.tsx` 加 describe「B3 broker row 常駐」:
  - 未選 → `[data-testid="chip-broker-row"]` 存在 + 內含「未選擇分點」+ 無「清除」button
  - 已選 1 → broker row 存在 + 內含「分點 (1)」label + 有「清除」button
  - 已選未選狀態下 `[data-testid="chip-broker-row"]` 都存在(anti-CLS)

**既有測試:** 全綠
- 14 test 全用 `new Set()`,現在 subH 分配變(未選時融資融券佔 subH 而不是 lastSubH)—— 但**現有測試不斷言 subH / lastSubH 值**(grep 確認 R1)→ 綠

**Trade-off 已於 Phase 2 接受**:
1. 未選狀態融資融券圖固定較小尺寸(從 lastSubH 縮至 subH)
2. **未選狀態 K 線本身縮 4.4%(41.2% → 36.8% totalH)**,已選狀態不變
3. 兩者換取「選 / 未選狀態全 subchart 幾何完全一致」,零 CLS

**Visual baseline 更新清單**(§7 e2e visual.spec.ts 需刷新):
- 未選狀態、無 window(single day)
- 已選 1 broker、無 window
- 未選狀態、有 window(N 日聚合 chip)
- 已選 1 broker、有 window

**tiny lastSubH 邊界**:mobile / 窄視窗下 lastSubH < 24px 時,placeholder 文字隱藏(避免文字裁切錯亂),容器保留。

---

### C5 🟢 — ChipBubbleView loading badge

**Files:** `frontend/src/components/ChipBubbleView.tsx`、`frontend/src/App.tsx`

**改動:**

`ChipBubbleView.tsx`:
- Props 新增 `loading?: boolean`
- 主 chart container(L144-161)包一層 relative,加 loading overlay + badge(對齊 ChipKlineChart L338-370 pattern):
```tsx
<div ref={bubbleRef} className="flex-1 min-h-0 overflow-hidden relative">
  {!bubbleData && !loading ? (
    <div className="h-full flex items-center justify-center text-ink-dim font-serif italic text-sm">
      請搜尋股票代號以載入泡泡圖
    </div>
  ) : bubbleSize.width > 0 && bubbleSize.height > 0 && bubbleData ? (
    <BubbleChartSvg ... />
  ) : null}
  {loading && (
    <div
      data-testid="bubble-loading-badge"
      className="absolute top-2 left-1/2 -translate-x-1/2 z-30 text-xs text-ink bg-bg-deep/90 px-3 py-1 border border-accent rounded shadow pointer-events-none flex items-center gap-2"
      aria-live="polite"
    >
      <svg viewBox="0 0 24 24" className="size-3.5 animate-spin text-accent">...</svg>
      載入 {symbol} 泡泡圖中…
    </div>
  )}
</div>
```

`App.tsx`:
- L413 `<ChipBubbleView ...>` 加 `loading={bubbleHook.loading && !!symbol}`

**新測試:**
- `ChipBubbleView.test.tsx` 加 describe「A5 loading badge」:
  - `loading={true} symbol="2330"` bubbleData 為 null → badge 出現 + 文字「載入 2330 泡泡圖中…」
  - `loading={false}` bubbleData 為 null → 空狀態「請搜尋股票代號…」
  - `loading={true}` bubbleData 已存在 → badge 疊在 chart 上(半透明 overlay)

**既有測試:** 全綠

---

### C6 🟢 — 分點總買/賣張/金額顯示

**Files:** `frontend/src/lib/chip-data.ts`、`frontend/src/components/ChipBubbleView.tsx`

**改動:**

`chip-data.ts` 新增 pure helper:
```ts
export interface BrokerTotals {
  buyLots: number;
  sellLots: number;
  buyAmount: number;   // 元 (buyLots × 1000 × price 加總)
  sellAmount: number;
}

/**
 * Compute total buy/sell lots + exact monetary amount for a single broker.
 * Amount = sum(row.buy × 1000 × row.price) — precise because FinMind rows are
 * pre-aggregated by (broker, price). Returns zeros when brokerId not found.
 */
export function computeBrokerTotals(
  trades: BrokerTrade[],
  brokerId: string | null,
): BrokerTotals {
  if (!brokerId) return { buyLots: 0, sellLots: 0, buyAmount: 0, sellAmount: 0 };
  let buyLots = 0, sellLots = 0, buyAmount = 0, sellAmount = 0;
  for (const t of trades) {
    if (t.broker_id !== brokerId) continue;
    buyLots += t.buy;
    sellLots += t.sell;
    buyAmount += t.buy * 1000 * t.price;
    sellAmount += t.sell * 1000 * t.price;
  }
  return { buyLots, sellLots, buyAmount, sellAmount };
}
```

`ChipBubbleView.tsx` header 區:
- 用 `useMemo` 算 `totals = computeBrokerTotals(bubbleData?.trades ?? [], selectedBrokerId)`
- 選 broker 時右側 header 加顯示區塊(在 BrokerSearch 右邊):
```tsx
{selectedBrokerId && (
  <div
    data-testid="bubble-broker-totals"
    className="flex items-center gap-3 text-xs text-ink-dim"
  >
    <span>買 <span className="text-accent tabular-nums">{fmtVol(totals.buyLots)}</span> 張</span>
    <span>賣 <span className="text-bear tabular-nums">{fmtVol(totals.sellLots)}</span> 張</span>
    <span>買額 <span className="text-accent tabular-nums">{fmtAmount(totals.buyAmount)}</span></span>
    <span>賣額 <span className="text-bear tabular-nums">{fmtAmount(totals.sellAmount)}</span></span>
  </div>
)}
```
- 新增 helper `fmtAmount(n: number): string` — 顯示成 `1.2 億` / `3,450 萬` / `123 元`(對齊 fmtVol 風格)

**新測試:**
- `chip-data.test.ts` 加 describe「computeBrokerTotals」:
  - Empty trades → zeros
  - brokerId=null → zeros
  - 單 broker 多 price → sum 正確 + amount = sum(buy×1000×price)
  - brokerId 不存在 → zeros
  - `fmtAmount` unit test(**統一 2 位小數,對齊 tabular-nums 版面**):1.2e8 → "1.20 億"、1.05e8 → "1.05 億"、1e7 → "1,000 萬"、1234 → "1,234 元"
- `ChipBubbleView.test.tsx` 加 describe「A3 broker totals display」:
  - 未選 → `[data-testid="bubble-broker-totals"]` 不存在
  - 選 broker → totals 存在 + 買/賣張數字正確 + 買/賣金額字串正確

**既有測試:** 全綠

---

### C7 🟢 — Y 軸 brush + summary + 篩選 button

**Files:** `frontend/src/components/ChipBubbleView.tsx`、`frontend/src/lib/chip-data.ts`(helper)

**改動:**

`chip-data.ts` 新增 pure helper:
```ts
export interface PriceRangeSummary {
  priceMin: number;
  priceMax: number;
  priceLevelCount: number;   // distinct prices in range
  brokerIds: string[];        // unique broker ids that traded in range
  buyLots: number;
  sellLots: number;
}

export function summarizeTradesByPriceRange(
  trades: BrokerTrade[],
  priceMin: number,
  priceMax: number,
): PriceRangeSummary {
  const inRange = trades.filter((t) => t.price >= priceMin && t.price <= priceMax);
  const prices = new Set(inRange.map((t) => t.price));
  const brokers = new Set(inRange.map((t) => t.broker_id).filter(Boolean));
  let buyLots = 0, sellLots = 0;
  for (const t of inRange) { buyLots += t.buy; sellLots += t.sell; }
  return {
    priceMin,
    priceMax,
    priceLevelCount: prices.size,
    brokerIds: [...brokers],
    buyLots,
    sellLots,
  };
}
```

`ChipBubbleView.tsx`:
- New state `const [brushRange, setBrushRange] = useState<{ min: number; max: number } | null>(null)`
- New callback `onYBrush` passed to BubbleChartSvg:接受 pixel-Y range → 反算 price range → setBrushRange
- BubbleChartSvg 新增 optional prop `onYBrush?: (priceMin, priceMax) => void`(不動 pure 算式,只加 overlay + pointer handler)
- Summary panel(浮動,固定位置右上或跟隨 range 中央):
```tsx
{brushRange && bubbleData && (
  <div
    data-testid="brush-summary"
    className="absolute right-4 top-4 z-40 bg-bg-deep/95 border border-accent px-3 py-2 rounded shadow-lg text-xs"
  >
    <div className="text-ink font-medium mb-1 tabular-nums">
      {brushRange.min.toFixed(2)} – {brushRange.max.toFixed(2)}
      <span className="text-ink-dim ml-2">
        ({brushSummary.priceLevelCount} 檔價位)
      </span>
    </div>
    <div className="text-ink-muted">
      涵蓋 {brushSummary.brokerIds.length} 個分點
    </div>
    <div className="text-ink-muted tabular-nums">
      買 {fmtVol(brushSummary.buyLots)} / 賣 {fmtVol(brushSummary.sellLots)} 張
    </div>
    <div className="flex gap-2 mt-2">
      <button
        type="button"
        data-testid="brush-apply-filter"
        onClick={() => onJumpToOverview?.(brushSummary.brokerIds)}
        className="text-accent hover:text-ink underline underline-offset-2 cursor-pointer"
      >篩選這 {brushSummary.brokerIds.length} 個分點 →</button>
      <button
        type="button"
        data-testid="brush-clear"
        onClick={() => setBrushRange(null)}
        className="text-ink-dim hover:text-bear cursor-pointer"
      >清除</button>
    </div>
  </div>
)}
```
- ESC key handler:`useEffect` 綁 window keydown,ESC → setBrushRange(null)
- 點空白清 brush:BubbleChartSvg 現有 `onBubbleClick(null)` 邏輯延伸 — 點空白既清 selection 也清 brush

**API 擴充**:
- `handleJumpToOverview` 現接單 broker_id → 擴成接 `string | string[]`:
```ts
const handleJumpToOverview = useCallback((brokerIdOrIds: string | string[]) => {
  const ids = Array.isArray(brokerIdOrIds) ? brokerIdOrIds : [brokerIdOrIds];
  setTab("overview");
  setSelectedBrokerIds(new Set(ids));
}, []);
```
- ChipBubbleView props: `onJumpToOverview?: (brokerIdOrIds: string | string[]) => void`

**Brush 交互實作**(BubbleChartSvg overlay layer,不動純算式):
- 泡泡圖左側 Y-axis padding (PADDING.left = 56) 內,加透明 `<rect>` 蓋整 Y 軸區域,綁 `onPointerDown/onPointerMove/onPointerUp`
- Drag start → 記 startY;drag move → 更新 endY + 反算 price via `y → price` linear interp;drag end → callback `onYBrush(priceMin, priceMax)` + 清 SVG 內臨時 highlight rect
- **抗誤觸**:drag end 時 `if (Math.abs(endY - startY) < 4) return` — 單擊不觸發(< 4px 判定為 click),同時避免 min === max 造成 empty summary
- Range 期間 SVG 內 render `<rect fill="rgba(240,180,41,0.1)" ...>` 顯示 band

**互動衝突處理**:
- **點空白清 brush**:ChipBubbleView 內 `handleBubbleClick(null)` 額外呼叫 `setBrushRange(null)`(既清 selection 也清 brush,對齊 user 描述 §Phase 0 SC-A1c)
- **Symbol 換股清 brush**:現有 `useEffect(() => { setSelectedBrokerId(null); }, [symbol])` 加一句 `setBrushRange(null)` — 對齊 C5 loading badge 出現時 brush summary 不殘留
- **Y-axis overlay vs bubble region 分離**:Y-axis overlay 是在 PADDING.left = 56 內側區域;bubble region 在其右側。Pointer 命中 bubble 不會觸發 onYBrush(SVG event 目標由 overlay `<rect>` 攔截)

**新測試:**
- `chip-data.test.ts` 加 describe「summarizeTradesByPriceRange」:
  - 空 trades / empty range → zeros
  - Range 涵蓋 3 個 price、2 個 broker → priceLevelCount=3、brokerIds.length=2
  - Range 完全在 min < priceMin → empty summary
- `ChipBubbleView.test.tsx` 加 describe「A1 Y-axis brush」:
  - Brush 由 setBrushRange 觸發 → summary panel 出現(mock BubbleChartSvg 直接呼叫 onYBrush prop)
  - 點 「篩選這 N 個分點」button → onJumpToOverview 被呼叫,參數 = brokerIds array
  - ESC → summary 消失
  - 點 「清除」button → summary 消失
  - 點空白處(handleBubbleClick(null))→ summary + selection 一起消失
  - Symbol change → brush range 也清空
- `chip-bubble-svg.test.tsx` 加 describe「A1 brush overlay」:
  - Y-axis overlay 存在(data-testid="bubble-yaxis-brush")
  - pointerdown + pointermove + pointerup on overlay(drag ≥ 4px)→ `onYBrush` 被呼叫,參數 min/max 對應 price scale 反算
  - pointerdown + pointerup 同位置(< 4px)→ `onYBrush` 不呼叫
  - pointerdown 在 bubble region(overlay 之外)→ `onYBrush` 不呼叫,現有 `onBubbleClick` 邏輯不受影響

**既有測試:** 全綠

---

### C8 🟢 — ChipBrokersPanel 整 row 可點

**Files:** `frontend/src/components/ChipBrokersPanel.tsx`

**改動:**
- Row wrapper 從 `<div>`(L76)改為 `<button type="button" onClick={onToggle}>` 或保 `<div>` + `onClick={onToggle}` + cursor-pointer + role="button" + tabIndex + keyboard handler
- **推薦**:保 `<div>` + `role="button"` + `onClick={onToggle}` + `onKeyDown` handler(Enter/Space)+ `tabIndex={0}`(避免 button 巢狀:內部有 checkbox + tooltip button)
- Checkbox `onCheckedChange` handler 需 `e.stopPropagation()` — 但 Radix Checkbox 的 onCheckedChange 是 controlled,沒有 pointer event...實際上 pattern 應該是:checkbox click bubble 到 row click 導致 double-toggle,所以要**在 checkbox wrapper 上加 `onClick={e => e.stopPropagation()}`** 而不是 checkbox 本身
- 加入 `focus-visible` outline 讓鍵盤可視

改後 row:
```tsx
<div
  role="button"
  tabIndex={0}
  aria-pressed={selected}
  onClick={onToggle}
  onKeyDown={(e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  }}
  className={`grid ${cls} items-center text-sm py-2 px-2 border-b border-line/40 cursor-pointer hover:bg-bg-deep/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${selected ? "bg-[#b794f4]/[0.06]" : ""}`}
>
  <span onClick={(e) => e.stopPropagation()}>
    <Checkbox
      checked={selected}
      onCheckedChange={onToggle}
      aria-label={`勾選 ${broker.name}`}
    />
  </span>
  <span className="text-ink-dim tabular-nums">{rank}</span>
  ... 其餘 columns
</div>
```

**新測試:**
- `ChipBrokersPanel.test.tsx` 加 describe「B1 整 row 可點」:
  - 點 row 空白處(非 checkbox)→ onToggleBroker called with 該 broker_id
  - 點 checkbox → onToggleBroker called **僅 1 次**(不 double-toggle)
  - Keyboard Enter/Space on focused row → onToggleBroker called

**既有測試:** 全綠(既有 28 test 未斷言「僅 checkbox 可觸發」)

---

## 4. 綜合測試矩陣

| 檔案 | 既有 test 數 | 預期紅? | 新增 test 數 |
|---|---|---|---|
| `ChipBubbleView.test.tsx` | 7 | 全綠 | ~10(A2 4 + A3 2 + A5 3 + A1 4)|
| `ChipBrokersPanel.test.tsx` | 28 | 全綠 | ~5(B1 3 + B2 3)|
| `ChipKlineChart.test.tsx` | 14 | 全綠 | ~3(B3 3)|
| `chip-data.test.ts` | 既有 | 全綠 | ~7(computeBrokerTotals 5 + summarize 2 + fmtAmount 3) |
| `BrokerSearch.test.tsx` | 全綠 | 全綠 | 0 |
| `chip-bubble-svg.test.tsx` | 全綠 | 全綠 | 0(如果 brush overlay 需獨立測則加 1-2) |
| `App.test.tsx` | 全綠 | 全綠 | 可能 0(mock 元件測不到具體 handler)|

**Backend 完全不動** → `pytest -q` 綠 baseline 維持。

---

## 5. Backward compat / migration

- **無資料格式改動**、**無 API 契約改動**、**無 localStorage 改動**
- 所有新 prop 都 `optional`(defensive fallback)
- Git revert 一鍵可回,無 side-effect

---

## 6. Phase 5 code review 檢查點

- 三類 commit 分明(git log 一眼分辨 🔵🔴🟢)
- CLS 檢查:B2 / B3 前後截圖對照
- A4 refactor 沒有意外改動 chip-bubble-svg / buildTradeRows 契約
- Handler 命名一致(`handleJumpToOverview` in App.tsx)
- 新 helper (`computeBrokerTotals` / `summarizeTradesByPriceRange` / `fmtAmount`) 都 pure + 有測試

## 7. Phase 6/7 自動化 + 真實環境驗證

**自動化 (auto-verify gate):**
```
backend/: python -m pytest -q      # 471 passed 維持
frontend/: npm test                # 505 → ~530 passed 維持全綠
frontend/: npm run build            # tsc 過
e2e/: npm test                     # 依 CLAUDE.md e2e 判準表:UI flow 改動 → 必跑
```

**e2e 判準**(CLAUDE.md §1 表):
- equity mode UI 改動 → `e2e/specs/equity.spec.ts` 加 E# spec:
  - E-A2:選單一分點 → 點 button → tab 切 overview + broker 在已選列表
  - E-B2:載入 equity 頁 → chip bar 容器已渲染(placeholder「未選擇分點」)
  - E-B3:載入 equity 頁 → K 線下 broker row 已渲染(placeholder)
  - E-A5:輸入新 symbol → loading badge 短暫出現後消失
  - **E-A1**:切 bubble tab → Y-axis 區域 pointer drag → summary panel 出現 → 點「篩選 N 個分點」→ tab 切 overview + 該批 broker 在已選列表(端到端)
  - **E-A3**:選單一分點 → 顯示區塊「買/賣張/金額」出現(靠 fixture 的 broker 手算對照數字)
- 視覺 diff → `e2e/specs/visual.spec.ts` V# baseline 更新(選 vs 未選狀態各一組)
- Phase 4 每個 commit 完成後跑對應相關 test group(全 gate 只在 Phase 6 全跑)

**真實環境:**
- 起 backend + frontend,拿 2330 / 2454 / 3481(高交易量)
- Bubble:brush 拉價位 range → summary 出現、button 有作用
- Bubble → 籌碼總覽跳轉:點 button → tab 切、broker 在已選
- 分點總買/賣張/金額:對照 FinMind raw 手算比對(至少 1 個 broker)
- 未選 / 已選狀態切換無 CLS(用 chrome-devtools-mcp 錄短影片 or 對照截圖)
- Console 乾淨

---

## 8. Sub-agent(Plan type)review criteria

- [ ] 8 個 commit 順序 🔵→🔴→🟢 對?
- [ ] Caller 影響全評估過?(BrokerSearch 保 name 契約 / chip-bubble-svg 保 name / App.tsx 新增 handler)
- [ ] 該紅 vs 不該紅 明確?(既有 test 應全綠;C2/C3/C4 三個 🔴 分別對應新增測試變紅 → 綠)
- [ ] Scope 沒滑?(backend 不動、pure 算式不動、BrokerSearch 不動)
- [ ] Migration 可逆?(全前端 UI + optional props → revert 無 side effect)
- [ ] Backward compat 風險點?(R3 name↔id 對應)

Max 2 輪。若 Plan agent 判斷有結構問題 → 回 Phase 2 收 scope。
