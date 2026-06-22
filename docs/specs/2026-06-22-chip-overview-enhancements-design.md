# 籌碼總覽五項增強功能設計規格

> 日期: 2026-06-22 · 狀態: 草案 (待 review)

---

## 1. 目標

在現有「籌碼總覽」與「泡泡圖」兩個 Tab 上,新增 5 項功能,協助使用者:

- 快速辨識「當沖嫌疑」分點
- 從 K 線 → 切回任一天的籌碼快照
- 跨越時間追蹤特定分點對該股票的進出習性
- 在泡泡圖快速聚焦單一分點

### 1.1 五項功能列表

| # | 功能 | 影響元件 |
|---|------|---------|
| F1 | 移除「買超前 15 合計」「賣超前 15 合計」兩列摘要 | `ChipBrokersPanel` |
| F2 | 籌碼列表 selectbar (「前 15 大買賣超」 / 「前 15 大交易量分點 + 當沖率」) | `ChipBrokersPanel` |
| F3 | K 線可點擊切換日期 (持續性金色 cursor) | `ChipKlineChart` / `App` |
| F4 | 籌碼列表勾選 N 個分點 → 第 6 列 sub-chart 顯示總和淨額 | `ChipBrokersPanel` / `ChipKlineChart` / 新 hook + 後端新 endpoint |
| F5 | 泡泡圖加入分點搜尋 typeahead → 選定後完全隱藏其他泡泡 | `ChipBubbleView` / 新元件 `BrokerSearch` |

### 1.2 不在範圍內

- 不改動 K 線渲染演算法、不改動既有 5 列 sub-chart 視覺
- 不引入新 UI 框架/元件庫
- 不調整 FinMind 速率限制、不變更現有快取版本號
- 不改變既有 API endpoint URL / response shape

---

## 2. 資料層設計

### 2.1 後端新增端點

```
GET /api/chip/{symbol}/broker_history?ids=A001,B002,C003&refresh=false
```

**Response:**
```json
{
  "symbol": "2330",
  "fetched_at": "2026-06-22T10:30:00",
  "last_date": "2026-06-22",
  "brokers": {
    "A001": [
      { "date": "2026-04-22", "buy": 120, "sell": 0, "net": 120 },
      { "date": "2026-04-23", "buy": 80, "sell": 200, "net": -120 }
    ],
    "B002": [...]
  }
}
```

- `ids` query: comma-separated `broker_id`,1–20 個,空字串視為錯誤
- `net = buy - sell`,單位為「張」(已從股轉張)
- 回傳的 `brokers` 字典僅包含 `ids` 中存在於後端 SecIdAgg 快取的;沒有任何紀錄的 broker_id 給空陣列 `[]`
- 日期範圍對齊 K 線視窗 (`history` endpoint 的 `start_date / end_date`,當前實作為 90 個日曆日)

### 2.2 後端快取設計

新增 cache 檔: `chip_cache_dir() / "{symbol}_broker_history.json"`

```python
{
  "_cache_version": 2,
  "symbol": "2330",
  "fetched_at": "2026-06-22T10:30:00",
  "last_date": "2026-06-22",
  "brokers": {
    "A001": [{"date": "...", "buy": ..., "sell": ..., "net": ...}, ...],
    "A002": [...],
    ...
  }
}
```

- 包含**所有**分點 (~200–500 個),不只請求的 IDs
- `last_date` 計算 = SecIdAgg 抓取的 `end_date` (= `date.today().isoformat()`),與既有 `fetch_chip_history` 一致 (`finmind.py:230, 284`)
- 命中規則: 若 `cached.last_date >= date.today().isoformat()` → 直接 return,不重抓
  - 週末/假日的 edge case:`date.today()` 不變,所以同一天內反覆呼叫不會重抓。下個交易日 `today` 進一,觸發重抓並覆蓋一次,符合既有 history 模式
- 與既有 `{symbol}_history.json` 快取**獨立**,不互相污染
- `refresh=true` 強制重抓並覆蓋
- **重要**: 若新抓取的 SecIdAgg 為空 (見 §2.3),**不**寫 cache 也**不**覆蓋既有 cache

### 2.3 後端共享既有 SecIdAgg 抓取邏輯

**SecIdAgg row schema 假設** (實作時必須先用 `curl` 對 `taiwan_stock_trading_daily_report_secid_agg` 端點驗證,否則 abort 並修正本 spec):
```python
# 預期每筆 row 含以下欄位
{
  "date": "2026-06-22",
  "securities_trader": "凱基-台北",
  "securities_trader_id": "9201A",
  "buy": 120000,    # shares (股)
  "sell": 80000,    # shares
  # 其他欄位忽略
}
```

- 重用既有 `_safe_get_secid_agg(symbol, start, end)` 包裝抓取 (`finmind.py:293–303`)
- **`_safe_get_secid_agg` 本身不動** — 既有 `_do_fetch_history` (line 250) 仰賴它失敗時靜默回 `[]` 才能讓 history endpoint 在 SecIdAgg 中斷時仍回 K 線/法人資料 (§7.2 不變更現有 API endpoint 約束)
- 新 `fetch_broker_history` 內部呼叫 `_safe_get_secid_agg`,**自行判斷**:若回傳 `[]` 且既有 cache 不存在 → raise `ValueError("secid_agg_unavailable")` 讓 route 回 503 `{"error": "secid_agg_unavailable"}`;若有舊 cache 則回舊 cache (`stale-while-error` 策略)
- 新純函數 `_parse_broker_history(rows: list) -> dict[str, list[dict]]`:
  - Group by `r["securities_trader_id"].strip()`
  - 每筆 daily 為 `{"date": ..., "buy": _to_lots(...), "sell": _to_lots(...), "net": buy_lots - sell_lots}`
  - 同一 (broker_id, date) 出現多次時加總 (理論上 SecIdAgg 已預先聚合,但保險)
  - 跳過 `securities_trader_id` 為空字串的 row
- 寫成 `services/finmind.py` 的新 method `fetch_broker_history(symbol, ids, refresh)`,內部呼叫 `_run_once` 防止 dog-piling (key = `broker_history_{symbol}`,**不**包含 ids,因為快取存的是全部分點)
- **讀全集 → 過濾 ids → 回 subset**: `fetch_broker_history` 讀 cache (或新抓) 得到「全部分點」字典後,在記憶體中過濾出 `ids` 要求的 subset 再回傳;cache 檔仍存全集

### 2.4 新後端路由

新增 `routes/chip.py` 的 handler:
```python
@router.get("/api/chip/{symbol}/broker_history")
async def get_chip_broker_history(symbol: str, ids: str, refresh: bool = False) -> dict:
    id_list = [s.strip() for s in ids.split(",") if s.strip()]
    if not id_list:
        raise HTTPException(status_code=400, detail={"error": "ids required"})
    if len(id_list) > 20:
        raise HTTPException(status_code=400, detail={"error": "too many ids (max 20)"})
    # ...error handling pattern matches existing endpoints
    return await get_finmind().fetch_broker_history(symbol, id_list, refresh)
```

### 2.5 前端 API client

`frontend/src/lib/api.ts` 新增:
```ts
chipBrokerHistory(
  symbol: string,
  ids: string[],
  refresh?: boolean
): Promise<ChipBrokerHistory>;
```

新 type (in `chip-data.ts`):
```ts
export interface BrokerDaily {
  date: string;
  buy: number;
  sell: number;
  net: number;
}

export interface ChipBrokerHistory {
  symbol: string;
  fetched_at: string;
  last_date: string;
  brokers: Record<string, BrokerDaily[]>;
}
```

---

## 3. Frontend State 與 Hook 設計

### 3.1 App-level state 變動 (`App.tsx`)

新增/修改:
```ts
// 既有
const [date, setDate] = useState(todayStr);

// 新增
const [selectedBrokerIds, setSelectedBrokerIds] = useState<Set<string>>(() => new Set());
const [selectedBrokerNames, setSelectedBrokerNames] = useState<Map<string, string>>(() => new Map());
```

- `selectedBrokerIds` 跨換日期保留,**跨換 tab 也保留**;只在 symbol 切換時清空 (§3.2)
- `selectedBrokerNames`: id → 顯示名稱的 mapping,使用者勾選時寫入,即使換日後該 broker 不在 top_brokers 仍可在 chips 區顯示名稱
- **泡泡圖選定分點 state 不在 App 層**: `selectedBubbleBroker` 仍保留在 `ChipBubbleView` 內部 (既有實作)。注意 `ChipBubbleView` 是 `lazy()` + `<Suspense>` + `hidden` 切換 (App.tsx:127),**不**會在 tab/symbol 切換時 unmount,因此重置邏輯依賴 §4.3.4 的 effect (只在 `symbol` 變化時清空,**不**依賴 `bubbleData`,以免換日期意外清空)

### 3.2 切換 symbol 時的重置邏輯

`handlePick` 內額外 `setSelectedBrokerIds(new Set())` 與 `setSelectedBrokerNames(new Map())`,因新 symbol 的分點不對應。
泡泡圖內部的 `selectedBroker` 因 symbol 變化會在 `useChipBubble` 重新抓 data 後由 component 自身的 effect 清空 (新增邏輯)。

### 3.3 K 線 click handler (F3)

`App` 接收 `ChipKlineChart` 透過 props 傳入的 `onPickDate(date)`,內部:
```ts
const handlePickDate = useCallback((d: string) => {
  if (d === date) return;            // no-op when same date — avoid re-render
  const lastCandle = history?.candles?.[history.candles.length - 1];
  // 點到「最新一天」=「回到 today/latest 訂閱」語意 — reset userPickedDate so
  // the existing snap-to-lastCandle effect (App.tsx:32-39) can re-engage on
  // next history reload (例:盤後刷新時 last candle 可能變新一日)
  userPickedDate.current = lastCandle ? d !== lastCandle.date : true;
  setDate(d);
}, [date, history]);

// Refresh button 連動 useBrokerHistory.refresh()
const refresh = () => {
  refreshChip();
  brokerHistoryHook.refresh();
  if (tab === "bubble") bubbleHook.refresh();
};
```

**設計意圖說明**: 「點最新一天」= 訂閱「未來更新後的最新日」(會 snap 到未來新加入的 candle);若使用者要「鎖定 2026-06-22 不要被自動跳轉」應點該日期之外的任何一天再點回來,維持 `userPickedDate.current = true`。此為 trade-off,記入 §9 風險。

### 3.4 新 Hook: `useBrokerHistory`

`frontend/src/hooks/useBrokerHistory.ts`:
```ts
export function useBrokerHistory(
  symbol: string,
  brokerIds: Set<string>,
): {
  series: Map<string, BrokerDaily[]>;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};
```

行為:
- 內部 `useRef<Map<string, BrokerDaily[]>>` 作為跨 render 的記憶體 cache
- Symbol 變更時清空 cache: `useEffect(() => { cacheRef.current.clear(); setSeries(new Map()); }, [symbol])`
- **Stable dep key**: 因為 `Set` 是新 reference 每次 setState 都換,內部以 `Array.from(brokerIds).sort().join(',')` 產生 stable string key 作 effect dep,避免無謂 diff
- 當 `brokerIds` 變化時,diff 出尚未在 cache 的 id,**單一 batch request 抓所有缺漏 ids** (避免並發),寫入 cache,再 setSeries 觸發 re-render
- 並發保護: `seqRef` 跟 useChipData 同樣模式 (採 seqRef 模式,不使用 AbortController)
- 當 `brokerIds` 為空集合: 不發 API,`series` 為空 Map,`loading` 為 false
- 網路錯誤: setError(...) 並保留既有 cache (不清空已成功的部分)
- `refresh()`: 清空 cache (`cacheRef.current.clear()`) 並對當前所有 `brokerIds` 重新 fetch (`refresh=true` query param 帶上),呼叫者為 App 的「重新整理」按鈕

### 3.5 衍生資料: 聚合日線

```ts
// in ChipKlineChart or new helper
function aggregateBrokerNetSeries(
  candles: DailyCandle[],
  series: Map<string, BrokerDaily[]>,
): number[] {
  const dateToNet = new Map<string, number>();
  for (const arr of series.values()) {
    for (const d of arr) {
      dateToNet.set(d.date, (dateToNet.get(d.date) ?? 0) + d.net);
    }
  }
  return candles.map(c => dateToNet.get(c.date) ?? 0);
}
```

---

## 4. 元件變動細節

### 4.1 `ChipBrokersPanel` (F1 + F2 + F4)

#### 4.1.1 結構移除 (F1)

- 刪除 line 125–128 的「買超前15合計」div
- 刪除 line 129–132 的「賣超前15合計」div
- 刪除 line 52–53 的 `buyTotal` / `sellTotal` 計算 (變成 dead code)
- `majorNet` (line 54) 改為直接從 `summary.top_brokers` 計算 (`buyers.slice(0,15).net.sum() + sellers.slice(0,15).net.sum()`),即原本 `buyTotal + sellTotal` 公式維持,但只在原地內聯
- 「主力買賣超」row (line 119–124) **保留**

#### 4.1.2 新增 selectbar (F2)

於「主力買賣超」之下、broker 列表之上,加 selectbar:
```tsx
<div className="px-3 py-2 border-b border-line flex items-center gap-2">
  <button onClick={() => setMode("net")} className={...}>前 15 大買賣超</button>
  <button onClick={() => setMode("volume")} className={...}>前 15 大交易量分點</button>
</div>
```

State `mode: "net" | "volume"` 區域於 `ChipBrokersPanel` 元件內。

#### 4.1.3 Mode "net" — 既有行為

完全沿用 `splitBrokers()`,顯示買超 / 賣超兩段、每段 top 15、columns: # / 分點 / 淨買賣 / 買張 / 賣張。

#### 4.1.4 Mode "volume" — 新邏輯

新純函數 (in `chip-data.ts`):
```ts
export interface TopVolumeBroker extends TopBroker {
  total: number;        // buy + sell
  daytradeRate: number | null; // null = sub-threshold
}

export function topByVolume(
  brokers: TopBroker[],
  dayTotalLots: number,
): TopVolumeBroker[] {
  const threshold = Math.max(1, Math.floor(dayTotalLots * 0.01));
  return brokers
    .map(b => {
      const total = b.buy + b.sell;
      const daytradeRate = total >= threshold && Math.max(b.buy, b.sell) > 0
        ? Math.min(b.buy, b.sell) / Math.max(b.buy, b.sell)
        : null;
      return { ...b, total, daytradeRate };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);
}
```

`dayTotalLots` 取得邏輯 (in `App.tsx`):
```ts
const dayTotalLots = useMemo(() => {
  if (!history?.candles || !summary?.date) return 0;
  const c = history.candles.find(c => c.date === summary.date);
  if (c) return c.volume;
  // Fallback: 該日不在 K 線 90 日窗 — 用 summary.top_brokers 的 sum(buy+sell) 估算
  return summary.top_brokers.reduce((s, b) => s + b.buy + b.sell, 0);
}, [history, summary]);
```

`ChipBrokersPanel` 接收 `dayTotalLots` 為 prop。若 `dayTotalLots === 0`,當沖率全部以「—」顯示 (避免除以 0 與假告警)。

Columns: # / 分點 / 買張 / 賣張 / 當沖率
- 當沖率欄顯示百分比 (整數)
- `daytradeRate >= 0.8` → `text-[#b794f4]` (紫,= MA20 color token)
- `0.5 <= daytradeRate < 0.8` → `text-[#f0b429]` (金,= MA5 color token)
- `daytradeRate < 0.5` → `text-ink-dim`
- `daytradeRate === null` → 顯示 "—",`text-line-strong`

#### 4.1.5 Checkbox 欄 + Chips 區 (F4)

每一列最左加一個 `<input type="checkbox">`,並重新調整 grid template (兩個 mode 各自更新):
- Mode "net": 既有 `grid-cols-[32px_1fr_90px_80px_80px]` → 新 `grid-cols-[22px_32px_1fr_90px_80px_80px]` (前置 22px checkbox 欄)
- Mode "volume": 新 `grid-cols-[22px_32px_1fr_64px_64px_76px]` (前置 checkbox + # + 分點 + 買張 + 賣張 + 當沖率)
- Checkbox: 14px×14px, unchecked = `border-line-strong`, checked = `bg-[#b794f4] border-[#b794f4]` (色票來自 `CHIP.ma20`)
- aria-label: `勾選 {broker.name}` (i18n: 中文字串)
- 切換 → 寫入 App-level `selectedBrokerIds` + `selectedBrokerNames` (透過 prop `onToggleBroker(broker_id, broker_name)`)
- `checked` 屬性綁定 `selectedBrokerIds.has(broker.broker_id)`,**不論 mode 或日期**;確保使用者切 mode 或換日期後,若該 broker 仍在當前 top 15 列表中,checkbox 顯示為勾選狀態
- chips 區 (§4.1.5 下方) 是「目前所有已選分點」唯一保證可見的入口 — 因為若該 broker 換日後不在 top 15,列表中無對應 row,chips 是唯一管理途徑

Selectbar 下方、broker 列表上方加 chips 區 (僅在 `selectedBrokerIds.size > 0` 時顯示):
```tsx
<div className="px-3 py-2 border-b border-line bg-bg-deep/40 flex flex-wrap gap-1.5 items-center">
  <span className="text-2xs text-ink-dim">已選 {N} 個分點:</span>
  {selected.map(id => (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-[#b794f4]/15 border border-[#b794f4]/40 text-[#b794f4]">
      {nameById.get(id) ?? id}
      <button onClick={() => onToggleBroker(id)}>×</button>
    </span>
  ))}
</div>
```

注意: chips 區的 broker 名稱可能在當天的 top_brokers 找不到 (使用者換了日期);應記錄 `id → name` 的 mapping 在 App-level state (新 `selectedBrokerNames: Map<string, string>`)。

### 4.2 `ChipKlineChart` (F3 + F4)

#### 4.2.1 Click handler (F3)

`KlineChartSvg` 既有 `hoverIndex` 計算 X-to-index。新增 `onClickIndex(i)` callback (props),內部在 svg 既有的 `<rect>` overlay 加 `onClick={(e) => { const i = computeIndex(e); if (i < 0 || i >= candles.length) return; onClickIndex(i); }}`。

guard 確保 padding 外或負值 index 不會炸 `candles[i].date`。

`ChipKlineChart` 接收 `onPickDate: (date: string) => void` prop,內部:
```tsx
<KlineChartSvg
  ...
  onClickIndex={(i) => onPickDate(candles[i].date)}
/>
```

#### 4.2.2 Selected-day cursor (F3)

`KlineChartSvg`、`InstBarSvg`、`MarginLineSvg`、新 `BrokerAggBarSvg` 四個元件的 signature 一律新增 `selectedIndex?: number | null` (預設 `undefined`)。

行為:
- `KlineChartSvg`: 當 `selectedIndex != null && 0 <= i < n` 時,於對應 X 位置畫 2px 寬金色 (#f0b429) 垂直線 (頂部 to 底部),頂端疊一個帶日期字樣的 small box (背景 `#14110c`、字 `#f0b429`)
- `InstBarSvg`、`MarginLineSvg`、`BrokerAggBarSvg`: 同樣 X 位置畫 1px 寬金色 (#f0b429) 垂直線 (無日期 box,僅做 hover 上下對齊參考)
- 父元件 `ChipKlineChart` 計算 `selectedIndex` 一次後傳給 `KlineChartSvg` + 4 個 `InstBarSvg` + `MarginLineSvg` + (可選) `BrokerAggBarSvg`,確保 X 計算共用同一份 step 寬度
- 「點最新一天 = 回到 today/latest」的邏輯實作在 §3.3 `handlePickDate` 內 (透過 `userPickedDate.current` 切換),**不**在 SVG 元件層判斷

注意:
- hover cursor (虛線) 與 selected cursor (實心金線) 是**獨立兩套**,可同時存在 (hover 為移動中,selected 為持續性)
- 既有未升級的呼叫者不傳 `selectedIndex` 仍可運作 (向下相容)

#### 4.2.3 第 6 列 BrokerAggBarSvg (F4)

新檔 `lib/chip-broker-agg-svg.tsx`:
- 結構複製 `InstBarSvg` (因為視覺要完全一致)
- 接收 `data: number[]`, `label: string`, `hoverIndex?: number | null`, `selectedIndex?: number | null`, `width`, `height`
- Label 字色改為紫色 (`#b794f4`,= `CHIP.ma20`),用以區分「這是分點 aggregate 列」(不畫左邊框 rect,保持與其他 5 列的視覺一致性,§1.2 約定)
- Label 顯示模式與既有 `InstBarSvg` 完全一致:由 BrokerAggBarSvg 自己以 `<text>` 渲染,顯示「分點 (N)」前綴 + 「+/-XXX 張」(其中 `(N)` 是父元件透過 prop `count: number` 傳入,XXX 由 `hoverIndex` 或最後一日的 `data[valIdx]` 自行計算 — 與 InstBarSvg L72–76 同模式)。父元件 `ChipKlineChart` 集中持有 `hoverIndex` state 並下發給所有 6 個子元件,確保 hover 數字同步
- 清除按鈕:`ChipKlineChart` 最外層 `<div ref={containerRef}>` 加 `relative`,清除按鈕為其 absolute 子元件 (`right: 8px`, 對齊第 6 列垂直中心),點擊呼叫 App 傳入的 `onClearAllBrokers`

`ChipKlineChart` 內 layout 重新計算:
```ts
const subCount = selectedBrokerIds.size > 0 ? 6 : 5;
const subH = Math.floor((totalH - gap - klineH) / subCount);
const lastSubH = totalH - gap - klineH - subH * (subCount - 1);
```

第 6 列只在 `selectedBrokerIds.size > 0` 時渲染,使用 `useBrokerHistory` hook + 聚合產生的 series。

**Layout 切換體驗**: 接受「5 → 6 列即時切換,每列高度立刻縮小」的視覺跳動,**不**做 transition 動畫 (簡化實作,且 sub-chart svg viewBox 已支援即時 resize)。

### 4.3 `ChipBubbleView` (F5)

#### 4.3.1 加入 header search bar

包裝原本左側 `<div ref={bubbleRef}>` 為:
```tsx
const uniqueBrokerCount = useMemo(
  () => new Set(bubbleData?.trades.map(t => t.broker) ?? []).size,
  [bubbleData],
);
// ...
<div className="h-full flex flex-col">
  <div className="shrink-0 h-10 px-3 border-b border-line bg-bg-deep/30 flex items-center gap-3">
    <BrokerSearch
      trades={bubbleData?.trades ?? []}
      value={selectedBroker}
      onChange={setSelectedBroker}
    />
    <span className="text-xs text-ink-dim">
      {selectedBroker
        ? <>已篩選 <span className="text-[#f0b429] font-medium">1</span> 個分點</>
        : <>今日共 <span className="text-[#b794f4] font-medium">{uniqueBrokerCount}</span> 個分點</>
      }
    </span>
  </div>
  <div ref={bubbleRef} className="flex-1 min-h-0 overflow-hidden">{/* BubbleChartSvg */}</div>
</div>
```

#### 4.3.2 新元件 `BrokerSearch.tsx`

模仿 `SymbolSearch` 結構:
```tsx
interface Props {
  trades: BrokerTrade[];
  value: string | null;
  onChange: (broker: string | null) => void;
}
```

行為:
- 預設輸入框顯示 `value` (若 null,顯示 placeholder「搜尋分點...」)
- 200ms debounce typing
- Dropdown 來源 = `trades` 去重後的 brokers,計算每個 broker 的 today total volume,按 desc 排序
- substring (case-insensitive) 過濾,匹配字串以 `<span className="text-[#f0b429]">` highlight
- 鍵盤 ↑/↓/Enter/ESC 支援 (`activeIdx` state)
- `onMouseDown` 處理選擇 (避免 blur 在 click 前發生)
- 旁邊「×」清除按鈕,onClick 呼叫 `onChange(null)`

#### 4.3.3 Bubble chart 過濾行為改變

`BubbleChartSvg` 既有 `selectedBroker` props 控制 dim-others。改為**完全隱藏其他泡泡** (使用者指定):

修改 `chip-bubble-svg.tsx`:
- 當 `selectedBroker` 不為 null,只渲染 `trades.filter(t => t.broker === selectedBroker)` 的泡泡
- 選定的泡泡加 `stroke="#f0b429" strokeWidth={2}` 突出

**右側 PriceBarSvg + TradeList 的過濾既有行為不變**: `ChipBubbleView` L65–99 既有 `priceAggs` / `filteredBuyRows` / `filteredSellRows` 邏輯持續使用,只有左側 BubbleChartSvg 從 dim 改 hide。實作者只需改 `chip-bubble-svg.tsx`,**不**要動 ChipBubbleView 內既有的 useMemo。

#### 4.3.4 雙向同步

`selectedBroker` state 保留在 `ChipBubbleView` 內部 (既有實作)。點泡泡時的 `onBubbleClick(broker)` 與 search 的 `onChange(broker)` 都寫入這個區域 state,實現雙向同步。

Symbol 重置邏輯 (必須只依賴 symbol,不依賴 date 與 bubbleData,以免換日期意外清空):
```ts
// ChipBubbleView 接收 symbol 為 prop
useEffect(() => {
  setSelectedBroker(null);
}, [symbol]);
```

---

## 5. 色票對應總表

| 用途 | 色碼 | 既有 token |
|------|------|-----------|
| 買進 / 上漲 / 正淨額 | `#e85a4f` | `--color-accent` / `--color-bull` |
| 賣出 / 下跌 / 負淨額 | `#7fc99a` | `--color-bear` |
| 主文字 / 暗字 | `#ede4d3` / `#8a8273` | `--color-ink` / `--color-ink-dim` |
| 細線 / 強線 | `#2e2a22` / `#4a4234` | `--color-line` / `--color-line-strong` |
| K 線選定日 cursor、當沖率 50-80%、search highlight | `#f0b429` | `chip-theme.CHIP.ma5` |
| 已選分點 chip / checkbox / 第 6 列 label 字色、當沖率 ≥80% | `#b794f4` | `chip-theme.CHIP.ma20` |

色碼一律使用 Tailwind 任意值語法 `text-[#f0b429]` 或從 `chip-theme.ts` import 常數,**不**新增 CSS variable。

---

## 6. 測試策略

### 6.1 後端 (`backend/tests/`)

新檔 `test_broker_history.py`:
- `test_parse_broker_history_groups_by_broker_id`
- `test_parse_broker_history_computes_net`
- `test_parse_broker_history_truncates_shares_to_lots`
- `test_parse_broker_history_empty_input`
- `test_parse_broker_history_skips_blank_broker_id`
- `test_parse_broker_history_aggregates_duplicate_date_rows`
- `test_fetch_broker_history_filters_to_requested_ids` (mock `_safe_get_secid_agg`)
- `test_fetch_broker_history_caches_full_payload` (verify cache file content)
- `test_fetch_broker_history_dedup_concurrent_calls` (verify `_run_once`)
- `test_fetch_broker_history_raises_when_secid_agg_empty` (對應 §2.3 失敗處理)
- `test_fetch_broker_history_uses_cache_when_last_date_today` (確保 `last_date >= today` 時直接 return)
- `test_fetch_broker_history_returns_empty_list_for_missing_broker_id`

新檔 `test_chip_broker_history_route.py`:
- `test_broker_history_400_on_empty_ids`
- `test_broker_history_400_on_too_many_ids`
- `test_broker_history_503_on_secid_agg_unavailable`
- `test_broker_history_success` (mock client)

### 6.2 前端 (`frontend/src/lib/` 與 `frontend/src/hooks/`)

擴充既有 `chip-data.test.ts`:
- `topByVolume sorts by total desc`
- `topByVolume computes daytrade rate correctly`
- `topByVolume returns null when below 1% threshold`
- `topByVolume returns null when dayTotalLots is zero`
- `topByVolume returns null when both buy and sell are 0`
- `topByVolume limits to 15`

新檔 `useBrokerHistory.test.ts` (使用 `@testing-library/react`):
- `does not fetch when brokerIds is empty`
- `fetches on first selection`
- `does not re-fetch already cached ids`
- `batches missing-from-cache ids into a single request`
- `clears cache when symbol changes`
- `ignores stale responses via seqRef`
- `sets error state on API failure and preserves cache`
- `refresh() clears cache and re-fetches all selected ids with refresh=true`
- `stable dep key prevents redundant fetches on Set reference change`

新檔 `BrokerSearch.test.tsx`:
- `shows placeholder when no value`
- `opens dropdown on typing with matches`
- `filters case-insensitive`
- `highlights matching substring`
- `keyboard arrow navigation`
- `Enter selects active`
- `Escape closes without select`
- `× clears value`
- `default dropdown sort by total volume desc`

擴充 `chip-svg.test.ts`:
- `BrokerAggBarSvg renders zero-line and bars matching InstBarSvg shape`
- `BrokerAggBarSvg renders selected-day cursor at correct X`
- `InstBarSvg renders selected-day cursor at correct X`
- `MarginLineSvg renders selected-day cursor at correct X`
- `KlineChartSvg fires onClickIndex with correct index`
- `KlineChartSvg ignores click outside candle range (guard)`
- `KlineChartSvg renders selected-day cursor`
- `KlineChartSvg does not render cursor when selectedIndex is null`

擴充 `api.test.ts`:
- `chipBrokerHistory builds correct URL with ids and refresh`

### 6.3 整合驗證 (手動)

- 搜尋 2330 → 切到 selectbar mode "volume" → 驗證 top 15 + 當沖率三段色 + 子門檻顯示 "—"
- 切回 mode "net" → 驗證 buy/sell sections 與既有一致
- 點 K 線第 30 天的 candle → date input 跟 chip panel 切換,sub-charts 出現金色 cursor
- 勾選 2 個 brokers → 第 6 列出現,值 = sum of nets;取消勾選 → 第 6 列消失
- 點 K 線最新一天 → selected cursor 消失 (回到「today」)
- 換 symbol → chips 區清空、selected cursor 清空
- 切到泡泡圖,在 search 輸入「凱」→ 看到下拉,選定後其他泡泡完全消失,search 顯示分點名,× 解除

---

## 7. 遷移與相容性

### 7.1 既有 cache 不需 invalidate

- 不改 `_CACHE_VERSION` (仍為 2)
- 新增的 `{symbol}_broker_history.json` 為獨立檔,沒有舊版本問題
- 舊的 `{symbol}_history.json`、`{symbol}_{date}.json`、`{symbol}_{date}_bubble.json` 完全不動

### 7.2 既有 API 端點 0 改動

所有改動皆為新增,既有 endpoint 的 URL、query params、response shape 均不變。

### 7.3 既有元件 props 增量擴充

`KlineChartSvg`、`InstBarSvg`、`MarginLineSvg` 都會新增 optional props (`selectedIndex?: number | null`、`KlineChartSvg` 額外有 `onClickIndex?`),預設值維持向下相容,不傳則表現如舊。父元件 `ChipKlineChart` 升級後皆會傳值;測試額外保留「不傳 / 傳 null 時不畫 cursor」case 以保護向下相容性。

---

## 8. 實作順序建議

1. 後端 — pure 函數 `_parse_broker_history` 與測試 (TDD)
2. 後端 — `fetch_broker_history` method + route + 測試
3. 前端 — `chip-data.ts` 新 types + `topByVolume` 函數 + 測試
4. 前端 — `api.ts` `chipBrokerHistory` + 測試
5. 前端 — `useBrokerHistory` hook + 測試
6. 前端 — `BrokerAggBarSvg` + 測試
7. 前端 — `KlineChartSvg` 加 `onClickIndex` + `selectedIndex` + 測試
8. 前端 — `InstBarSvg` / `MarginLineSvg` 加 `selectedIndex` + 測試
9. 前端 — `ChipBrokersPanel` 改造 (selectbar + checkbox + chips)
10. 前端 — `ChipKlineChart` 串接 hook + 第 6 列渲染
11. 前端 — `BrokerSearch` 元件 + 測試
12. 前端 — `ChipBubbleView` 加 search header + 切換 dim → hide 行為
13. 前端 — `App.tsx` 串接 state + 換 symbol 重置
14. 手動整合驗證
15. `/code-review`、`/requesting-code-review`、`/receiving-code-review`

---

## 9. 風險與待解事項

- **SecIdAgg 涵蓋率 — 整段無資料**: 若 `_safe_get_secid_agg` 回傳空 list (FinMind 中斷或該股票無資料),`fetch_broker_history` raise `ValueError("secid_agg_unavailable")`,route 回 503。前端 `useBrokerHistory` setError,UI 顯示提示「分點歷史資料暫無法取得」於第 6 列 label 處。
- **SecIdAgg 涵蓋率 — 部分日期缺漏**: 整段抓得到但個別日期缺,聚合函數對缺漏 date 給 0,UI 顯示為「該日無進出」,**不**回錯。
- **SecIdAgg row schema 未驗證**: §2.3 已標記實作時必須先用 `curl` 驗證,若實際 schema 與假設不同需先修 spec。
- **回傳 broker_id 大小寫 / 空白**: FinMind 偶爾回傳 `securities_trader_id` 帶空白。`_parse_broker_history` 在 group 時 `id.strip()`,前端比對也用 strip 過的版本。
- **快取檔大小**: 熱門股 (2330) 60 天 × ~300 brokers ≈ 18,000 列 × ~50 bytes ≈ 900 KB JSON。可接受,GZip middleware 已壓縮。
- **第 6 列 hover/selected cursor 對齊**: 與既有 5 列共用同一 X 換算邏輯,務必抽出共用函數避免 magic number 重複。
- **當沖率閾值 80% / 50% / 1% 為作者主觀設定**: 80% 對應「買賣張數幾乎打平」、50% 對應「至少一半資金當沖」、1% 過濾極小成交量造成的高比率假告警。未來可調 / 加 UI 設定。
- **當沖率 `buy = sell = 0` 與 sub-threshold 都顯示 "—"**: 兩種狀況訊息不同但 UI 統一,屬刻意設計。若需區分,日後可在 tooltip 分流。
- **K 線「點最新一天 = 訂閱未來最新日」race**: 詳見 §3.3 設計意圖說明。盤後資料刷新會 snap;若需「鎖定 2026-06-22 不被自動跳轉」需先離開該日再點回。

---

## 10. 完成標準 (Definition of Done)

- [ ] 後端所有新測試通過 (`python -m pytest -v`)
- [ ] 前端所有新測試通過 (`npx vitest run`)
- [ ] 前端 build 無錯 (`npm run build`)
- [ ] Ruff 0 issues (`ruff check .`)
- [ ] TS 0 errors (`npx tsc -b`)
- [ ] 5 項功能在 dev server 上手動操作均無問題 (含 console 無錯誤)
- [ ] `/code-review`、`/requesting-code-review`、`/receiving-code-review` 三回合完成
- [ ] 鍵盤操作:checkbox、selectbar 三段、BrokerSearch 的 Tab/Enter/Space/Arrow/Escape 行為驗證通過 (a11y)
