# Design — ChipBrokersPanel 從「單日」改成「N 日加總視窗」

**Date:** 2026-06-26
**Type:** `/mod` 修改既有行為
**Branch:** `feat/txo-chip-framework`
**Status:** Draft for user review

---

## 1. 目標(一句話)

把右側 `ChipBrokersPanel`(420px)從「當前選定日的單日 broker 買賣明細」改成「以選定日為**終點**、往前回推 N 個 **trading days** 的 broker 買賣加總明細」,N 由 RangeSelector(按鈕 10/20/30/60)+ 滾輪細調(10–60 任意整數)控制。K 線視窗、K 線下方歷史柱狀、已勾選分點歷史柱狀**完全不受 N 影響**,固定 90 天。

例:選 2026-06-20、N=10 → 右側面板顯示 2026-06-04 ~ 2026-06-20(10 個 trading days)的 broker 加總。

---

## 2. 現狀對照

| 元素 | 現狀(post v3 spec) | 新行為 |
|------|---------------------|--------|
| 左側 K 線視窗 | RangeSelector 控制 5/10/20/60/180 | **固定 90 天**,N 不再影響 |
| 左側 K 線下方 法人/融資融券/major 歷史柱狀 | 同上,跟 K 線同窗 | **固定 90 天** |
| 已勾選分點歷史柱狀(`useBrokerHistory`) | 同上 | **固定 90 天** |
| 右側 `ChipBrokersPanel` 主力買賣超 / 融資融券 / 前 15 大 | 單日(`summary` payload) | **過去 N 個 trading days 加總**,以選定日為終點 |
| RangeSelector 按鈕 | 5 / 10 / 20 / 60 / 180 | **10 / 20 / 30 / 60** |
| RangeSelector 互動 | 點擊 + 鍵盤 ←→ | + **滾輪細調** 10–60 任意整數 |
| localStorage key | `chip_range`(union `5|10|20|60|180`)| `chip_window_days`(整數 10–60)|

---

## 3. 既有行為白名單(不可破壞)

| # | 既有行為 | 為何必須保留 |
|---|----------|--------------|
| W1 | `GET /api/chip/{symbol}/history` 不帶 query 回 90 天 | backward compat |
| W2 | `GET /api/chip/{symbol}/broker_history?ids=...` 不帶 days 回 90 天 | 同上 |
| W3 | `GET /api/chip/{symbol}` 行為不變(單日 summary)| 加總路徑走新 endpoint,**不擴充** summary |
| W4 | 既有 backend 182 個 pytest 全綠 | baseline |
| W5 | 既有 frontend 233 個 vitest 全綠 | baseline |
| W6 | `summary.top_brokers` 排序(by abs(net) desc)、`splitBrokers` 切 buyers/sellers 邏輯不變 | 前端 reuse |
| W7 | `dayTotalLots` fallback 邏輯(date 落 K 線外 → summary.top_brokers 加總 / 2)不變 | K 線仍 90 天故 fallback 還會用 |
| W8 | 籌碼總覽 lazy-suspense / tab hidden 不重渲染 結構不變 | 性能不退化 |
| W9 | K 線 stale fallback 不變 | resilience |
| W10 | options 模組(MaxPain / OIWalls / PCR / Institutional / Spot)完全零修改 | scope 之外 |

---

## 4. Out of Scope

- avg_buy_price / avg_sell_price 在 N 日加總下的**精準** weighted average(只給 approximate,見 §6.3)
- 對非 trading day 的「插補」— 我們只取最近 N 個 trading days,不做 weekend/holiday fill
- K 線視窗變化(完全鎖死 90)
- BB / MA 計算改動
- summary endpoint 加 `days` param
- `_CACHE_VERSION` bump
- 升級 dependencies / 重排目錄

---

## 5. 架構

### 5.1 後端新 endpoint(additive)

```
GET /api/chip/{symbol}/brokers_window
    ?date=YYYY-MM-DD         # 視窗終點;預設今天
    &days=N                  # N ∈ [10, 60];預設 10
    &refresh=BOOL            # 預設 false
```

**內部流程**:
1. 取 `fetch_chip_history(symbol)` 的 candles → 取得 trading_dates (最多 90 個)
2. 從 trading_dates 中過濾出 `d ≤ date` 的部分,取最後 N 個
3. 對每個 d,呼叫 `fetch_chip_summary(symbol, d)`(有 per-day cache,命中率高)
4. Aggregate(見 §6)
5. 回傳 ChipBrokersWindow shape(見 §5.3)

**為何走 history → trading_dates**:
- FinMind 對非交易日 return 空 → 直接 fetch 90 天會浪費 ~⅓ 呼叫
- candles 本身已 cache,複用 trading_dates 0 額外成本
- 若 history 還沒 fetch,先 fetch_chip_history(也 cache)

**不加 cache 自己**:因為 fetch_chip_summary 各天已 cache,N 天再 cache 多此一舉。

### 5.2 前端

#### Hook 變更
- `useChipData(symbol, date)` — **拿掉 days 參數**;backend 用 default 90 → K 線視窗固定 90 天
- `useBrokerHistory(symbol, ids)` — **拿掉 days 參數**;已勾選分點歷史固定 90 天
- **新 hook** `useChipBrokersWindow(symbol, date, windowDays)`:
  - TanStack Query, queryKey = `["chip-brokers-window", symbol, date, windowDays]`
  - 回 `{ data: ChipBrokersWindow | null, loading, error, refresh }`
  - 對外 shape 沿用「{data, loading, error, refresh}」慣例

#### Component 變更
- `RangeSelector.tsx`:
  - `RangeDays` type 從 `5|10|20|60|180` → **改成 `number`** (10–60 整數)
  - `RANGE_DAYS_OPTIONS` 從 `[5,10,20,60,180]` → `[10, 20, 30, 60]`
  - 加 `onWheel` handler:wheel delta → `clamp(value ± 1, 10, 60)`(`preventDefault` 阻止頁面捲動)
  - 鍵盤 ←→ 行為改成:在連續整數空間 ±1(不是跳到下個 preset)
  - 顯示上,當前值若不是 preset,所有按鈕都不 active,但 group 旁附小字「{N} 日」標示當前值
  - 重命名 export 為 `WindowSelector` / `WindowDays` 比較貼新語意(但 file 不重命名以減少 diff,內部 export rename)

- `ChipBrokersPanel.tsx`:
  - Props 從 `summary: ChipSummary | null` + `dayTotalLots: number` 改成:
    - `window: ChipBrokersWindow | null`(或保留 summary shape + 加 `windowDays: number`)
    - `dayTotalLots: number`(仍用於 daytradeRate 分母 — 改為「N 日總成交張」)
  - Header 加「過去 {N} 日加總」字樣
  - 內部 `splitBrokers / topByVolume` 邏輯不變(吃 TopBroker[])
  - **資料來源從 `summary` 切到 `window`**;`summary` 變成「只用來填 `institutional` 顯示在 K 線下方」?— 不,目前 panel 沒用 institutional,所以 summary 在 panel 完全可被 window 取代

- `App.tsx`:
  - `range` state 改名 `windowDays`,型別 `number`,localStorage key 改 `chip_window_days`
  - 從 storage 讀取走 whitelist:`Number.isInteger(n) && n >= 10 && n <= 60`,否則 fallback 30(預設)
  - 移除 `useChipData(..., range)` / `useBrokerHistory(..., range)` 的第三參
  - 新增 `useChipBrokersWindow(symbol, date, windowDays)`,把回傳的 `window` 傳給 ChipBrokersPanel
  - `dayTotalLots` 計算改:用 `windowSummary.totalTradedLots`(server 算)而不是從 K 線 candle 找

### 5.3 API contract

#### Request
```
GET /api/chip/2330/brokers_window?date=2026-06-20&days=10
```

#### Response — `ChipBrokersWindow`
```typescript
{
  symbol: string;              // "2330"
  date: string;                // anchor end date — user pick (echo)
  window_days: number;         // 10
  trading_dates: string[];     // ["2026-06-04", ..., "2026-06-20"] — actually used
  fetched_at: string;          // ISO timestamp
  // 直接 reuse TopBroker shape,因為 frontend splitBrokers/topByVolume 不需改:
  top_brokers: TopBroker[];    // by abs(N-day net) desc
  // N-day 加總 margin(change 累加 + end_date balance/ratio):
  margin: {
    margin_purchase: { balance: number; change: number; limit: number };
    short_sale:      { balance: number; change: number; limit: number };
    short_balance_ratio: number;
  };
  // N-day 加總 institutional(目前 panel 沒展示,但保留以備未來):
  institutional: {
    foreign: { buy: number; sell: number; net: number };
    trust:   { buy: number; sell: number; net: number };
    dealer:  { buy: number; sell: number; net: number };
  };
  // 給 daytradeRate 用,= sum of (top_brokers.buy + top_brokers.sell) / 2 — 後端算好給前端
  total_traded_lots: number;
  // 若 trading_dates < days(date 還沒夠多歷史),server 仍回所有可用 days、不報錯
  // frontend 拿這個跟 days 比,UI 顯示「實際 X 日,目標 N 日」提示
  actual_days: number;         // = trading_dates.length
}
```

#### Error contract(沿用既有 pattern)
- `400` `{"detail":{"error":"invalid_days"}}` — days 超過 [10,60](FastAPI Query 用 `ge=10, le=60`)
- `502` `{"detail":{"error":"finmind_failure"}}` — 全部 day fetch 失敗(已透過 main.py 全域 handler 包)
- `503` `{"detail":{"error":"service_not_ready"}}` — FinMind token 缺(同上)

---

## 6. Aggregate 公式

### 6.1 top_brokers(逐 broker 加總,by abs net 排序)

對每個出現過的 `broker_id`:
- `buy = sum(daily buy)`
- `sell = sum(daily sell)`
- `net = buy - sell`
- `name` = 取最後一次出現的 name(同 id 通常 name 不變;若變以最新者為準)

排序、切 buyers/sellers 由前端的 `splitBrokers` 處理(行為不變)。

### 6.2 institutional / margin

- **institutional**:每個欄位(foreign_buy, foreign_sell, trust_buy, trust_sell, dealer_buy, dealer_sell)各自 N 日 sum,net 重算
- **margin**:
  - `margin_purchase.change = sum(daily margin_purchase.change)`(N 天淨增減)
  - `short_sale.change = sum(daily short_sale.change)`
  - `margin_purchase.balance / limit / short_sale.balance / limit / short_balance_ratio` = 取 **end_date 那天** 的值(這些是時點數據,不是流量)

### 6.3 avg_buy_price / avg_sell_price(approximate weighted)

每日 summary 的 avg_*_price 已經是當日 share-weighted average。N 日加權平均近似:

```
N_day_avg_buy_price = Σ (daily_avg_buy_price × daily_buy) / Σ daily_buy
                    (對 buy > 0 的日子)
```

**不是完全精確**(完全精確需 share-by-share price),但在實務上跟「N 日內個別交易的真實 share-weighted average」誤差小,可接受。理由:每日 avg 本身已 share-weight,日間 price 差距大時略偏。

若 `Σ daily_buy == 0` → `avg_buy_price = 0`(panel 已會 fmt 成 "—")。

### 6.4 total_traded_lots

```
total_traded_lots = floor( Σ (broker.buy + broker.sell) / 2 )
```

跟既有 `dayTotalLots` fallback 同公式(broker buy + sell ≈ 2 × volume)。

---

## 7. Diff-Level Plan(逐檔)

順序:🔵 → 🟢 → 🟢 → 🟢。沒有 🔴(no destructive behavior change to existing endpoints/hooks signature backward-compat).

### A. 🔵 純重構(同 commit 與 🟢 backend 分開)

#### A1. `frontend/src/components/ui/RangeSelector.tsx` — internal rename(no behavior change)
- `RangeDays` rename → `WindowDays`(file 內 type alias 改名)
- `RANGE_DAYS_OPTIONS` rename → `WINDOW_DAYS_PRESETS`
- import 處(App.tsx)同步改名
- **此 step 仍然 type = `5 | 10 | 20 | 60 | 180`,值不變** — 純 rename
- 測試 import name 同步改

> **Note**:rename + behavior change 分開可避免 review 混亂。但 v3 spec 提倡「同 commit 一起改」如果是 mechanical alignment。我選分開因為 RangeSelector 行為改動較大(scroll + 範圍變)。

### B. 🟢 後端新 endpoint

#### B1. `backend/services/finmind.py`

加新 method:
```python
async def fetch_brokers_window(
    self, symbol: str, date_str: str, days: int, refresh: bool = False,
) -> dict:
    # 1. 拿 history 取 trading_dates(複用 fetch_chip_history cache)
    history = await self.fetch_chip_history(symbol, refresh=refresh, days=90)
    trading_dates = [c["date"] for c in history["candles"] if c["date"] <= date_str]
    selected = trading_dates[-days:]  # 倒數 N 個

    # 2. fan-out fetch_chip_summary(已 per-day cache)
    summaries = await asyncio.gather(*[
        self.fetch_chip_summary(symbol, d, refresh) for d in selected
    ], return_exceptions=True)

    # 3. aggregate(見 §6)
    valid_summaries = [s for s in summaries if not isinstance(s, BaseException)]
    if not valid_summaries:
        raise ValueError("brokers_window_unavailable")

    return _aggregate_brokers_window(symbol, date_str, days, selected, valid_summaries)
```

加純函式 `_aggregate_brokers_window(symbol, date_str, days, trading_dates, summaries)`:
- 實作 §6 公式
- Return 符合 §5.3 shape 的 dict

**No cache**(per-day summary 已 cache);**no _CACHE_VERSION bump**。

#### B2. `backend/routes/chip.py`

加新 route:
```python
@router.get("/api/chip/{symbol}/brokers_window")
async def get_chip_brokers_window(
    symbol: str,
    date: str = Query(default=""),
    days: int = Query(default=10, ge=10, le=60),
    refresh: bool = Query(default=False),
) -> dict:
    d = date or _today()
    return await get_finmind().fetch_brokers_window(symbol, d, days, refresh)
```

### C. 🟢 前端

#### C1. `frontend/src/lib/chip-data.ts`
加 type:
```typescript
export interface ChipBrokersWindow {
  symbol: string;
  date: string;
  window_days: number;
  trading_dates: string[];
  fetched_at: string;
  top_brokers: TopBroker[];
  margin: ChipSummary["margin"];           // reuse
  institutional: ChipSummary["institutional"]; // reuse
  total_traded_lots: number;
  actual_days: number;
}
```

#### C2. `frontend/src/lib/api.ts`
加 `api.chipBrokersWindow(symbol, date, days, refresh?)`:
```typescript
chipBrokersWindow(
  symbol: string, date: string, days: number, refresh?: boolean,
): Promise<ChipBrokersWindow> {
  const params: Record<string, string> = { date, days: String(days) };
  if (refresh) params.refresh = "true";
  return get(`${BASE}/chip/${symbol}/brokers_window`, params);
}
```

#### C3. `frontend/src/hooks/useChipBrokersWindow.ts`(新檔)
```typescript
export function useChipBrokersWindow(
  symbol: string, date: string, windowDays: number,
): { data: ChipBrokersWindow | null; loading: boolean; error: string | null; refresh: () => void } {
  const forceRef = useRef(false);
  const q = useQuery<ChipBrokersWindow, Error>({
    queryKey: ["chip-brokers-window", symbol, date, windowDays],
    queryFn: async () => {
      const force = forceRef.current; forceRef.current = false;
      return api.chipBrokersWindow(symbol, date, windowDays, force);
    },
    enabled: symbol !== "" && date !== "",
    placeholderData: keepPreviousData,
  });
  return {
    data: q.data ?? null,
    loading: q.isFetching,
    error: q.error?.message ?? null,
    refresh: () => { forceRef.current = true; q.refetch(); },
  };
}
```

#### C4. `frontend/src/hooks/useChipData.ts`
- 拿掉第三參 `days`
- queryKey 從 `["chip-history", symbol, days ?? "default"]` 改回 `["chip-history", symbol]`
- queryFn 一律 `api.chipHistory(symbol, force)`(走 overload 2)
- API 內部仍維持 backend 90 天 default

#### C5. `frontend/src/hooks/useBrokerHistory.ts`
- 拿掉第三參 `days`
- queryKey 同 `["broker-history", symbol, id]`(拿掉 days 維度)
- queryFn `api.chipBrokerHistory(symbol, ids, force)`(走 overload 2)
- 整體 cache 維度退回原本(降複雜度)

#### C6. `frontend/src/components/ui/RangeSelector.tsx`(行為改 — 在 §A1 rename 之後做)
- `WindowDays = number`(10–60 整數)
- `WINDOW_DAYS_PRESETS = [10, 20, 30, 60]`
- props:
  - `value: number`(10–60)
  - `onChange: (n: number) => void`
- 渲染:4 顆 preset button + 右側小字「N 日」(顯示當前值,即使不在 preset)
- 滾輪:`onWheel` on container,e.preventDefault + `onChange(clamp(value - sign(deltaY), 10, 60))`
  - **注意 React 對 wheel 預設是 passive listener**;要用 `useRef` + `addEventListener("wheel", h, { passive: false })`,否則 preventDefault 無效
- 鍵盤:← / → 在 [10, 60] 範圍內 ±1,Home → 10、End → 60
- A11y:`role="spinbutton"` + `aria-valuemin=10` + `aria-valuemax=60` + `aria-valuenow={value}` + `aria-label="N 日加總視窗"`
  - radiogroup pattern 不適用(N 不是離散選一個 — 是 [10,60] 整數)
  - preset button 變成 quick-set,各自有 `aria-label="設為 X 日"`

#### C7. `frontend/src/components/ChipBrokersPanel.tsx`
- Props:
  - `summary` 改名 `windowData: ChipBrokersWindow | null`
  - `dayTotalLots` 改名 `windowTotalLots: number`
  - 其他 props 不變
- Header 顯示「過去 {windowData.window_days} 日加總 ({windowData.actual_days < window_days 時加 "(實際 X 日)"})」
- 主力買賣超、融資融券、前 15 大 三段顯示邏輯不變(only data source 變)

#### C8. `frontend/src/App.tsx`
- `range` state 改名 `windowDays: number`,初始化 30 (新預設)
- localStorage key 改 `chip_window_days`,讀取走 whitelist:`Number.isInteger(n) && n >= 10 && n <= 60`
- `useChipData(symbol, date)` 拿掉第三參
- `useBrokerHistory(symbol, selectedBrokerIds)` 拿掉第三參
- 新增 `const brokersWindow = useChipBrokersWindow(symbol, date, windowDays)`
- 把 ChipBrokersPanel 的 props 改:
  - `windowData={brokersWindow.data}`
  - `windowTotalLots={brokersWindow.data?.total_traded_lots ?? 0}`
  - `loading={brokersWindow.loading}`
- `refresh()` 多加一個 `brokersWindow.refresh()`
- `RangeSelector value={windowDays} onChange={setWindowDays}`
- `dayTotalLots` useMemo 邏輯整個移除(改吃 brokersWindow 的 total_traded_lots)

---

## 8. 既有測試影響

### 8.1 必要 patch(🔵 signature alignment,同 hook 變更 commit)

| 檔案 | 變更 | 說明 |
|------|------|------|
| `frontend/src/hooks/useChipData.test.ts:155` | `mock.calls[1]![2]` → `mock.calls[1]![1]` | 拿掉 days 後 refresh 退回第 2 位 |
| `frontend/src/hooks/useBrokerHistory.test.ts:115` | `mock.calls[1]![3]` → `mock.calls[1]![2]` | 同上 |
| `backend/tests/test_chip_broker_history_route.py:66` | `assert_called_once_with("2330", ["A","B"], False, 90)` → `(..., False)` | route 拿掉 days param 之後 service 也只收 3 個 positional |
| `backend/tests/test_chip_routes.py::test_chip_history_*_days` | **刪除**(4 個 test) | days param 已從 history endpoint 移除,測試 obsolete |
| `backend/tests/test_finmind.py::test_fetch_chip_history_days_separates_cache` | **刪除** | 同上 |
| `backend/tests/test_broker_history.py::test_fetch_broker_history_days_separates_cache` | **刪除** | broker_history 拿掉 days |
| `frontend/src/lib/api.test.ts::chipHistory days` | **刪除** | 拿掉 chipHistory 的 days overload |
| `frontend/src/lib/api.test.ts::chipBrokerHistory days` | **刪除** | 同上 |
| `frontend/src/hooks/useChipData.test.ts::days 改變時 refetch` | **刪除** | days 不存在 |
| `frontend/src/hooks/useBrokerHistory.test.ts::days 改變時` | **刪除** | 同上 |

### 8.2 ⚠️ 需要 verify 的灰區

| 檔案 | 風險 | 對策 |
|------|------|------|
| `backend/services/finmind.py::fetch_chip_history(symbol, refresh, days=90)` | 還要不要保留 `days` 參數? | **保留**(只是 default 90 + 沒人傳) — 避免 cache key 改動 + 既有 cache file 不變 + future 想再用就還在 |
| `backend/services/finmind.py::fetch_broker_history(symbol, ids, refresh, days=90)` | 同上 | **保留** |
| `backend/routes/chip.py` route 是否拿掉 days query? | 兩條路:拿掉(simpler) vs 保留(future-proof) | **拿掉**,因為前端不再用,且 422 driven by Query 可能造成 confused error |

### 8.3 新增測試

| 檔案 | 新測 |
|------|------|
| `backend/tests/test_brokers_window.py`(新檔) | (a) basic aggregate:3 個 trading day 餵已知 summary → 預期 top_brokers buy/sell/net (b) avg_price weighted 公式 (c) margin change 累加 + balance 取 end_date (d) institutional N 日 sum (e) total_traded_lots 公式 (f) actual_days < days 時不 error (g) days=10 / 60 邊界 (h) refresh=true 觸發 history + summary 全 refetch |
| `backend/tests/test_chip_routes.py::test_chip_brokers_window_*` | (a) basic 200 (b) days=9 → 422 (c) days=61 → 422 (d) symbol+date+days happy path |
| `frontend/src/lib/api.test.ts` | `chipBrokersWindow` URL 含 date+days+refresh; refresh 不帶時不在 URL |
| `frontend/src/hooks/useChipBrokersWindow.test.ts`(新檔) | (a) 啟用條件 (b) refresh 走 force=true (c) queryKey 隔離 windowDays 改變 |
| `frontend/src/components/ui/RangeSelector.test.tsx`(改寫) | (a) 4 preset button 顯示 (b) 點擊 preset → onChange (c) 滾輪 +1/-1 + clamp [10,60] (d) 鍵盤 ← → ±1 + Home/End (e) 當前值不在 preset 時所有 button 不 active 但小字顯示 N (f) spinbutton ARIA |
| `frontend/src/components/ChipBrokersPanel.test.tsx` | (a) header 顯示「過去 N 日加總」 (b) actual_days < window_days 時顯示提示 (c) windowData=null fallback (d) splitBrokers 在 N 日加總資料下排序正確 |

### 8.4 預期 baseline
- backend: 182 - 6 obsolete + ~10 新 = ~186 全綠
- frontend: 233 - 4 obsolete - 改寫 RangeSelector test (~10 個 it) + ~15 新 + 改寫 ~10 個 = 預期 ~240+ 全綠

---

## 9. Caller Map

### 後端
- `fetch_chip_history`:`routes/chip.py:get_chip_history`、`routes/chip.py:get_chip_brokers_window`(新)、tests
- `fetch_chip_summary`:`routes/chip.py:get_chip_summary`、`fetch_brokers_window`(新)、tests
- `fetch_broker_history`:`routes/chip.py:get_chip_broker_history`、tests
- 動態用法:0(已 grep)

### 前端
- `useChipData`:`App.tsx:71`(唯一)
- `useBrokerHistory`:`App.tsx:73`(唯一)
- `useChipBrokersWindow`(新):`App.tsx`(唯一)
- `RangeSelector`:`App.tsx:162`(唯一)
- `api.chipHistory`、`api.chipBrokerHistory`:hook + test
- `api.chipBrokersWindow`(新):hook + test

---

## 10. Commit 切分(順序執行)

1. `refactor(chip): rename RangeSelector internals to WindowSelector terminology` 🔵 — A1 純 rename,行為不變
2. `feat(chip): backend brokers_window endpoint + N-day aggregate service` 🟢 — B1+B2+B 對應新 tests
3. `feat(chip): useChipBrokersWindow hook + api.chipBrokersWindow + types` 🟢 — C1+C2+C3 + 對應 tests
4. `feat(chip): RangeSelector behavior — number value, scroll, preset 10/20/30/60` 🟢 — C6 + 改寫 RangeSelector tests
5. `feat(chip): wire brokers_window into ChipBrokersPanel + App, drop range from K-line hooks` 🟢 — C4+C5+C7+C8 + 移除 obsolete tests
6. `chore(chip): DevTools MCP verification screenshots` — 完工後

---

## 11. 驗證計畫

完成前 gate(`auto-verify`):
- `cd backend && python -m pytest -q` → 預期 ~186 全綠
- `cd frontend && npm test` → 預期 ~240 全綠
- `cd frontend && npm run build` → tsc 0 error

DevTools MCP 真實環境:
- dev server 起,輸入 2330、日期選 2026-06-20
- 預設 N=30:右側面板 header 顯「過去 30 日加總」、前 15 大數字明顯大於單日值
- 按 10 → 主力買賣超數字變小;按 60 → 變大;K 線**沒變化**
- 滾輪在 RangeSelector 上 → N 在 10–60 間連續變;K 線**沒變化**
- 跨非交易日邊界:選日 = 連假後第一個 trading day,N=5 取 5 個 trading day(略過假日)→ trading_dates 確認
- 切到 K 線左邊已勾選分點 → 視覺仍 90 天(K 線沒受影響)
- 重 load page → localStorage 還原 N
- Console 乾淨
- 截圖 5 張:N=30 / N=10 / N=60 / 滾輪細調 N=27 / RangeSelector 焦點狀態 → `docs/specs/2026-06-26-chip-brokers-window/screenshots/`

回頭逐條核 W1–W10。

---

## 12. 失敗 routing(3 次上限)

- 既有測試紅(非 §8.1 / §8.3 列出的)→ 對照 §8 caller map,找漏改的呼叫,**不准改 assertion** 過關
- avg_price 加總公式造成測試 fail → 看 §6.3 是否誤解 weighted 含義
- 滾輪 preventDefault 無效 → 確認用 `addEventListener` + `{passive: false}`,而不是 React onWheel
- N 邊界 9 / 61 沒被 422 → backend Query `ge=10, le=60` 沒設好
- `actual_days < days` 沒回 partial → `_aggregate_brokers_window` 應該對 `summaries` 為空才 raise

3 次過後 → 停下,回報 phase / error / 3 種試過策略 + 推測根因(per CLAUDE.md C 條 D 條)。
