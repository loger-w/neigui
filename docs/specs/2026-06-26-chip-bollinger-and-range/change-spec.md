# Change Spec — Chip Overview Bollinger Bands + Date Range Selector (v3)

**Date:** 2026-06-26
**Type:** `/mod` (修改既有功能)
**Branch:** `feat/txo-chip-framework` → 建議拆 child branch `feat/chip-bollinger-range`
**Version:** v3 — Plan round 2 找出 P0-C/D/E + P1-6/7/8;round 2 是 /mod 流程允許的最後一輪,本人收尾整合,不再 review。

## v3 修正摘要(置頂讓實作直接看到)

| Plan finding | v3 對策 |
|--------------|--------|
| **P0-C** useChipData.test.ts:155 `mock.calls[1]![1] === true` 因 days 插入第 2 位而失效 | 老實承認:該行改為 `mock.calls[1]![2] === true`(refresh 位置後移到第 3 位),屬 🔵 signature-alignment refactor,跟 hook signature 同 commit 修 |
| **P0-D** useBrokerHistory.test.ts:115 `mock.calls[1]![2] === true` 同樣失效 | 同上 改為 `mock.calls[1]![3] === true` |
| **P0-E** route handler 給 service 的 call 形式會打到 `test_chip_broker_history_route.py:66` 的 `assert_called_once_with("2330", ["A","B"], False)` | 老實承認:route 一律 positional 傳 days(4th arg);測試 assertion 改成 `("2330", ["A","B"], False, 90)`,屬 🔵 同 commit 修。**不採取** route 內 if days==90 分支的 hack |
| **P1-6** TS overload 不能直接寫在 object literal 的 method 上 | api.ts 採 **explicit type interface** 模式:`type ChipHistoryFn = { (symbol): ...; (symbol, refresh: boolean): ...; (symbol, days: number, refresh?): ... };` 然後 `chipHistory: chipHistoryImpl as ChipHistoryFn` |
| **P1-7** BB days=20 → 只 1 個 non-null mid → polyline 渲染空 + legend 顯示 → 誤導 | 改 render 條件 **`nonNullCount >= 2`**(不是 `some`)。days < 21 → BB 整組隱藏(legend + 線 + 帶);driveTools 驗證 §8 對應修正 |
| **P1-8** 新測試 count 算錯 | 修正為「backend +7 / frontend +15 it() across 5 files」|
| P2-4 inflight key 也要 conditional | 跟 cache_key 同 helper,當 days==90 用 `"history_2330"`,否則 `"history_2330_60d"` |
| P2-5 debounce | 不採用,留 next-time |

**v3 既有測試影響更新**:從「zero modifications」改為「**4 處 1-line patch**,均為 mechanical signature alignment(🔵)」。其他 209 backend test + 207 frontend test 仍然零修改。

---


---

## 1. 目標

讓使用者在「籌碼分析 → 籌碼總覽」分頁能:
1. K 線圖上看到 **Bollinger Bands**(20 期 / 2σ,固定參數)
2. 透過一個 **5 / 10 / 20 / 60 / 180 天的區間選擇器** 切換籌碼總覽的視窗
3. 區間選擇器影響:K 線 + 法人歷史 + 融資融券歷史 + 主力券商歷史 + 已勾選分點的歷史柱狀。**不影響**「該日摘要」與「泡泡圖」(它們都是單日視圖)
4. 日期欄位(現有 DateField)語意保持 = 區間「結束日錨點」,改 = 區間整個往過去推

## 2. 既有行為白名單(不能被破壞)

| # | 既有行為 | 為何必須保留 |
|---|--------|------------|
| W1 | `GET /api/chip/{symbol}/history` 不帶任何 query 仍回 90 天 | backward compat — 既有測試與外部 caller 預設值 |
| W2 | `GET /api/chip/{symbol}/broker_history?ids=...` 不帶 `days` 仍回 90 天 | 同上 |
| W3 | 既有 backend 113 個 pytest 全綠(其中 112 個零修改、1 個 `test_chip_broker_history_route.py:66` 增加 `90` 至 assertion args 為 🔵 signature alignment)| baseline |
| W4 | 既有 frontend 211 個 vitest 全綠(其中 208 個零修改;`useChipData.test.ts:155` 與 `useBrokerHistory.test.ts:115` 各 1 行 index shift 🔵)| baseline |
| W5 | 籌碼總覽 K 線「lazy-suspense → tab hidden 不重渲染」結構不動 | 性能不退化 |
| W6 | DateField 邏輯不變(`userPickedDate` ref 自動 snap to last candle) | 互動慣性 |
| W7 | `dayTotalLots` fallback(date 落在 K 線視窗外時用 summary.top_brokers 重算)依舊運作 | 視窗縮成 5 天時這條路會更常觸發,必須正確 |
| W8 | `summary` (`/api/chip/{symbol}`) 與 `bubble` (`/api/chip/{symbol}/bubble`) 完全不受影響 | 它們是單日視圖、跟 range 無關 |
| W9 | K 線 stale fallback(FinMind 故障時 serve 舊 cache 並帶 `stale: true`)行為不變 | resilience 不退化 |
| W10 | Days==90 的 cache file 路徑保持 `{symbol}_history.json` / `{symbol}_broker_history.json` 不改名 | seed-cache 測試(`test_broker_history.py` × 4、`test_finmind.py` × 4)不需 patch |

## 3. Out of Scope

- BB 參數(period / k)UI 控制 — 鎖死 20/2
- 自訂 days(不在 5/10/20/60/180 內的整數)— 後端 query param 會擋 `ge=5,le=365` 但 UI 不開
- 區間影響 summary 或 bubble — 它們維持 single-day
- KD / MACD / 其他指標 — 留 next-time
- Migration script 清掉舊 cache 檔 — 不需要(W10 設計下沒有 orphan)
- 不重排既有檔案 / rename 既有 symbol / 升 dependency
- `_CACHE_VERSION` 不 bump(W10 設計下沒理由 bump)

## 4. Diff-Level Plan(逐檔 + 🔴🟢🔵 分類)

> **順序:🔵 → 🟢 → 🟢**(沒有 🔴)。所有改動都設計成 additive,所有 caller 都帶 default value → 既有 caller 零修改、既有測試零修改。

### A. 🔵 純重構

#### A1. `frontend/src/lib/chip-kline-svg.tsx`
- 將內部 `calcMA(closes, period)` 改名為 `rollingMean(values, period)`,**signature 不變**,export 出來作為 generic helper(供 BB 中軌使用)
- 新增 export `rollingStd(values, period)`(母體標準差,跟 SMA 同視窗 — 業界 BB 標準)
- 既有 `calcMA(closes, 5)` / `calcMA(closes, 20)` 兩處呼叫改用 `rollingMean`
- **既有測試零變化**(`chip-svg.test.ts` 不 import calcMA,只測 `klineScaleY` 等純幾何;已 grep 確認)

### B. 🟢 新功能 — Backend

#### B1. `backend/services/finmind.py`

**Cache key 設計(conditional,W10 保護)**:
```python
def _history_cache_key(symbol: str, days: int) -> str:
    return f"{symbol}_history" if days == 90 else f"{symbol}_history_{days}d"

def _broker_history_cache_key(symbol: str, days: int) -> str:
    return f"{symbol}_broker_history" if days == 90 else f"{symbol}_broker_history_{days}d"
```
- 兩個 helper 加在 `FinMindClient` 或 module-level
- `_CACHE_VERSION` **保留 3,不 bump**
- 既有 `2330_history.json` / `2330_broker_history.json` 落地不變 → W10 ✓

**Signature 與行為**:
- `fetch_chip_history(self, symbol, refresh=False, days=90)` — 新增 **optional kwarg** `days=90`
  - 既有 caller `client.fetch_chip_history("2330")` / `client.fetch_chip_history("2330", refresh=True)` 都不需改 — `days` 用 default 90
- `_do_fetch_history(self, symbol, cache_key, days)` — `timedelta(days=90)` → `timedelta(days=days)`
- `_run_once` 的 inflight key 改為 `f"history_{symbol}_{days}d"`(每 window 自己 dedup)
- 同樣套到 `fetch_broker_history(self, symbol, ids, refresh=False, days=90)` 與 `_do_fetch_broker_history`
- 不影響 summary / bubble / options 路徑

#### B2. `backend/routes/chip.py`
- `get_chip_history`: 加 `days: int = Query(default=90, ge=5, le=365)`,傳入 service
- `get_chip_broker_history`: 加 `days: int = Query(default=90, ge=5, le=365)`,傳入 service
- 不動 summary / bubble 兩個 endpoint

### C. 🟢 新功能 — Frontend

#### C1. `frontend/src/lib/chip-kline-svg.tsx`
- 加 `calcBollinger(closes, period=20, k=2)` 純函式 → 回傳 `{ middle, upper, lower }`,皆 `(number | null)[]`,長度同 closes
  - 用 §A1 新的 `rollingMean` + `rollingStd`;前 (period-1) 筆為 null
  - period 內無變異(std=0)→ upper === lower === middle(spec §9 edge case)
- 加 BB SVG 渲染:
  - 中軌 #6db0d8 solid 1.2px opacity 0.85
  - 上下軌 #6db0d8 dashed 0.8px opacity 0.6
  - 帶狀填充 #6db0d8 fillOpacity 0.06(以 path `M (xUpper points) → reverse(xLower points) Z` 一條 closed path)
- BB 顏色 inline hex `#6db0d8`(chart-local 常數,不放進 chip-theme.ts — 跟 MA5/MA20 一樣風格)
- BB 上下軌 / 中軌 **納入** `pMin / pMax` 計算(避免上軌被切掉)
- Legend + 三條線 + 帶狀填充 整組條件 render:`countNonNull(bbMid) >= 2`(P1-7 fix)。days < 21 時 mid 至多 1 個非 null → 直接整組不顯示(legend、線、帶皆隱)
- Legend 排版:`MA5(padL+4) MA20(padL+44) BB(20,2)(padL+90)` 一列

#### C2. `frontend/src/components/ui/RangeSelector.tsx`(新檔)
- 5 個 pill button(`5 日 / 10 日 / 20 日 / 60 日 / 180 日`)
- `Props`: `{ value: RangeDays; onChange: (v: RangeDays) => void; disabled?: boolean }`,其中 `type RangeDays = 5 | 10 | 20 | 60 | 180`
- 樣式:
  - 容器 `inline-flex border border-line-strong`
  - 各 button:`px-3 py-1.5 text-sm border-r border-line-strong last:border-r-0 transition-colors cursor-pointer`
  - 選中:`text-ink border-accent bg-accent/[0.08]`(注意 border-accent 只覆蓋當下這顆,不重排 group border)
  - 未選:`text-ink-dim hover:text-ink`
  - disabled:`opacity-50 cursor-default`,點擊 no-op
- **A11y(P2-1 fix)**:採 radiogroup 模式
  - 容器 `role="radiogroup"` + `aria-label="K 線區間"`
  - 各 button `role="radio"` + `aria-checked={value === n}` + `tabIndex={value === n ? 0 : -1}`(roving tabindex)
  - 鍵盤:← / → 在 group 內輪轉(取得焦點時自動觸發 onChange)
  - 測試覆蓋鍵盤 + 點擊兩條路徑

#### C3. `frontend/src/lib/api.ts`

**Overload signatures(P1-6 fix)** — 用 explicit interface 套到 object literal property,避免 method shorthand 不能宣告 overload 的 TS 限制:

```typescript
type ChipHistoryFn = {
  (symbol: string): Promise<ChipHistory>;
  (symbol: string, refresh: boolean): Promise<ChipHistory>;
  (symbol: string, days: number, refresh?: boolean): Promise<ChipHistory>;
};

function chipHistoryImpl(
  symbol: string,
  daysOrRefresh?: number | boolean,
  refresh?: boolean,
): Promise<ChipHistory> {
  const days = typeof daysOrRefresh === "number" ? daysOrRefresh : undefined;
  const r = typeof daysOrRefresh === "boolean" ? daysOrRefresh : refresh;
  const params: Record<string, string> = {};
  if (days !== undefined) params.days = String(days);
  if (r) params.refresh = "true";
  return get(`${BASE}/chip/${symbol}/history`, params);
}

// in `export const api = { ... }`:
chipHistory: chipHistoryImpl as ChipHistoryFn,
```

同 pattern 套到 `chipBrokerHistory`:
```typescript
type ChipBrokerHistoryFn = {
  (symbol: string, ids: string[]): Promise<ChipBrokerHistory>;
  (symbol: string, ids: string[], refresh: boolean): Promise<ChipBrokerHistory>;
  (symbol: string, ids: string[], days: number, refresh?: boolean): Promise<ChipBrokerHistory>;
};
```

**Param 規則(P1-4 fix,明確化)**:
- `days` 為 `undefined` → URL **不帶** `days` query → 後端 default 90 → W1/W2 滿足
- `days` 有值 → URL **一律帶** `days=<n>`,即使值是 90(讓 module cache key 包含 days,前後一致)
- 既有 `api.chipHistory("2330", true)` / `api.chipHistory("2330", true)` 走 overload 2 → 行為等價
- Hook 使用 overload 3:`api.chipHistory(symbol, days, force)`

`cacheKey()` 已會把 `days` 列入 sort,自動分窗 — 不改 cacheKey 本身

#### C4. `frontend/src/hooks/useChipData.ts`
- 新增 **optional** 第三個參數 `days?: number = 60`(default 60 = 新 UI 預設;既有 caller 不傳就拿 60 — 但既有 caller 只有 App.tsx,改完都會傳)
- 測試 caller `useChipData("2330", "2026-06-19")` 不需改:拿 default 60,query 帶 `?days=60` — 但 test 用 `vi.spyOn(api, "chipHistory")` mock 整個 function,不檢查 days 參數 → 既有 assertion 不受影響(W3 ✓)
- `queryKey` 改為 `["chip-history", symbol, days]`
- `api.chipHistory(symbol, days, force)` 帶入
- `summary` query 不變
- 對外 return shape 不變

#### C5. `frontend/src/hooks/useBrokerHistory.ts`
- 新增 **optional** 第三個參數 `days?: number = 60`
- mutation `api.chipBrokerHistory(symbol, ids, days, force)`
- cache slot queryKey 加 days:`["broker-history", symbol, id, days]`(分窗 cache、不互相污染)
- 對外 return shape 不變

#### C6. `frontend/src/App.tsx`
- 新 state `range: RangeDays`,初始化從 localStorage(P2-3 fix,whitelist):
  ```typescript
  const [range, setRange] = useState<RangeDays>(() => {
    const raw = localStorage.getItem("chip_range");
    const n = Number(raw);
    const valid = [5, 10, 20, 60, 180] as const;
    return (valid as readonly number[]).includes(n) ? (n as RangeDays) : 60;
  });
  useEffect(() => { localStorage.setItem("chip_range", String(range)); }, [range]);
  ```
- 傳入 hook:`useChipData(symbol, date, range)`、`useBrokerHistory(symbol, selectedBrokerIds, range)`
- UI 放置:header row,在 DateField 與 refresh button 之間
- `<RangeSelector value={range} onChange={setRange} disabled={isLoading} />`

### D. 新增測試清單

| 檔案 | 新測試 |
|------|-------|
| `backend/tests/test_chip_routes.py` | `test_chip_history_with_days` — 帶 `?days=60`,service 收到 days=60 |
| `backend/tests/test_chip_routes.py` | `test_chip_history_default_days` — 不帶 days,service 收到 days=90(W1)|
| `backend/tests/test_chip_routes.py` | `test_chip_history_days_out_of_range` — `?days=1000` 回 422 |
| `backend/tests/test_chip_routes.py` | `test_chip_history_days_too_small` — `?days=1` 回 422(下界 5) |
| `backend/tests/test_chip_broker_history_route.py` | `test_broker_history_with_days` — 帶 days 透傳到 service |
| `backend/tests/test_finmind.py` | `test_fetch_chip_history_days_separates_cache` — days=60 與 days=90 寫不同 cache file path,互不污染 |
| `backend/tests/test_broker_history.py` | `test_fetch_broker_history_days_separates_cache` — 同上 |
| `frontend/src/lib/chip-bollinger.test.ts`(新檔)| `calcBollinger` 純函式 unit:(a) 空陣列 (b) 短於 period 全 null (c) period=20/k=2 對已知序列產出正確 mid/upper/lower (d) period 內變異為 0 → upper=lower=mid (e) period=5 確認與 rollingMean 一致 |
| `frontend/src/components/ui/RangeSelector.test.tsx`(新檔)| (a) 5 個 button render (b) click 60 → onChange(60) (c) value=20 → 第三顆 `aria-checked=true` (d) disabled 時 click 不觸發 (e) 鍵盤 ArrowRight 從 20→60 觸發 onChange (f) `role=radiogroup` + `aria-label` 正確 |
| `frontend/src/lib/api.test.ts` | `chipHistory` 帶 days 時 URL 含 `?days=60`;不帶時不含 days param(明確 P1-4) |
| `frontend/src/lib/api.test.ts` | `chipBrokerHistory` 帶 days 時 URL 含 days |
| `frontend/src/hooks/useChipData.test.ts` | days 改變時 history 重新 fetch(新 queryKey)|
| `frontend/src/hooks/useBrokerHistory.test.ts` | days 改變時 mutation 觸發新 fetch、各 days 自己 cache slot |

### E. 既有測試影響表 — 4 處 1-line 🔵 signature alignment,其餘零修改

下表逐一說明既有測試為何不會紅、以及 4 處須 1-line patch 的地方。如果實作完跑出非預期紅 → 立刻回 §A/B/C 找漏的 caller 或漏的 default。

**🔵 須 1-line patch 的 4 處(同 hook/route signature commit 一起改)**:

| 檔案:行 | 原 | 改後 | 說明 |
|---------|---|------|------|
| `backend/tests/test_chip_broker_history_route.py:66` | `mock.assert_called_once_with("2330", ["A", "B"], False)` | `mock.assert_called_once_with("2330", ["A", "B"], False, 90)` | route 一律 positional 傳 days,預設 90 |
| `frontend/src/hooks/useChipData.test.ts:155` | `expect(histSpy.mock.calls[1]![1]).toBe(true)` | `expect(histSpy.mock.calls[1]![2]).toBe(true)` | hook 改 `api.chipHistory(symbol, days, force)`,refresh 從 [1] 移到 [2] |
| `frontend/src/hooks/useBrokerHistory.test.ts:115` | `expect(spy.mock.calls[1]![2]).toBe(true)` | `expect(spy.mock.calls[1]![3]).toBe(true)` | hook 改 `api.chipBrokerHistory(symbol, ids, days, force)`,refresh 從 [2] 移到 [3] |
| (如需要 — 視 backend route 實作)|  |  | 若 `routes/chip.py` 對 `get_chip_history` 也走 positional 4 args,看是否影響 `test_chip_routes.py::test_chip_history`(該測試只 assert status_code 與 `len(candles)`,不檢查 args)→ **預期不影響**,無需修 |



| 檔案 | 既有測試 | 預期 | 不會紅的理由 |
|------|--------|------|------------|
| `backend/tests/test_chip_routes.py` | `test_chip_history` | 🟢 不變綠 | 不帶 days → service `fetch_chip_history("2330", False)` 用 default `days=90`,assertion 維持 |
| `backend/tests/test_chip_routes.py` | `test_chip_summary*` × 4 | 🟢 不變綠 | summary 路徑零修改 |
| `backend/tests/test_chip_routes.py` | `test_chip_bubble` | 🟢 不變綠 | bubble 路徑零修改 |
| `backend/tests/test_chip_broker_history_route.py` | `test_broker_history_strips_whitespace_ids`(line 66)| 🔵 1-line patch | **見上方 patch 表**:assertion 補上 `90` 為第 4 個 positional arg |
| `backend/tests/test_chip_broker_history_route.py` | 其他 4 test | 🟢 不變綠 | 同理 |
| `backend/tests/test_finmind.py` | `test_fetch_chip_history*` × 5(含 `2330_history.json` seed × 4)| 🟢 不變綠 | days==90 默認 → cache key `2330_history`(W10)→ 既有 seed 路徑命中,行為等價 |
| `backend/tests/test_broker_history.py` | `test_fetch_broker_history*` × 11(含 `2330_broker_history.json` seed × 4)| 🟢 不變綠 | 同理。**Plan 提到的 literal `"_cache_version": 3` 不改** — `_CACHE_VERSION` 不 bump,3 仍然是當前值 |
| `backend/tests/test_gzip.py` | `test_gzip_history_endpoint` | 🟢 不變綠 | mock `fetch_chip_history` return value;不檢查 signature args |
| `frontend/src/lib/api.test.ts` | `chipHistory` 系列 | 🟢 不變綠 | `api.chipHistory("2330")` / `api.chipHistory("2330", true)` 仍合法 — 因為 `days?` 是 optional;`refresh` 從第 2 位移到第 3 位但呼叫風格不變(用 TS overload 確保兩種形式都過)|
| | | | **小心點**:既有 `api.chipHistory("2330", true)` 把 `true` 當第 2 位 → 新 signature 下 `true` 會撞到 `days?: number` 位置。修法:不要把 `refresh` 移位,改成 `chipHistory(symbol, options?: { days?: number; refresh?: boolean })` 或用 TS overload。**選 overload(下方詳述)**讓既有測試零變化 |
| `frontend/src/lib/api.test.ts` | `chipBrokerHistory` 既有 | 🟢 不變綠 | 同理用 overload |
| `frontend/src/hooks/useChipData.test.ts` × 多筆 | `useChipData(symbol, date)` 二參形式 | 🟢 不變綠(除 line 155)| 新 signature `useChipData(symbol, date, days?: number = 60)` — 二參呼叫合法。**line 155 須 🔵 1-line patch**(見上方表)|
| `frontend/src/hooks/useBrokerHistory.test.ts` × 多筆 | `useBrokerHistory(symbol, ids)` | 🟢 不變綠(除 line 115)| 同理。**line 115 須 🔵 1-line patch**(見上方表)|
| `frontend/src/lib/chip-svg.test.ts` | 純幾何測試 | 🟢 不變綠 | 不打到 MA / BB |
| `frontend/src/components/ChipBrokersPanel.test.tsx` | UI 互動 | 🟢 不變綠 | 改動不到 panel |
| 其他 (ChipBubbleView / options / OptionsPage 等)| 全部 | 🟢 不變綠 | 改動範圍封閉,不碰它們 |

**🔑 沒有任何測試「該變紅」** — implement 後若有非預期紅,SOP:
1. 對照本表確認該測試屬哪一格
2. 若該格說「不變綠」但實際紅了 → 我打到無關東西,立刻 stash 看打到什麼
3. **不准為了過而改 assertion**(除非該 assertion 本來就在新測試清單裡)

#### api.ts overload 細節(避免 `chipHistory("2330", true)` 撞 days)
```typescript
// Overload signatures — 既有測試保留:
function chipHistory(symbol: string): Promise<ChipHistory>;
function chipHistory(symbol: string, refresh: boolean): Promise<ChipHistory>;
function chipHistory(symbol: string, days: number, refresh?: boolean): Promise<ChipHistory>;
// Implementation 用 typeof 判斷第 2 位
function chipHistory(symbol: string, daysOrRefresh?: number | boolean, refresh?: boolean) {
  const days = typeof daysOrRefresh === "number" ? daysOrRefresh : undefined;
  const r = typeof daysOrRefresh === "boolean" ? daysOrRefresh : refresh;
  // ... build params
}
```
同 pattern 套到 `chipBrokerHistory`。

## 5. Caller Map(完整,Plan round-1 補完)

### 後端 service 層 callers
- `fetch_chip_history`:`backend/routes/chip.py:44`、`backend/tests/test_chip_routes.py:51`(mock)、`backend/tests/test_gzip.py:35`(mock)、`backend/tests/test_finmind.py:185/268/308/349/394/425/460`(直接呼叫)
- `fetch_broker_history`:`backend/routes/chip.py:58`、`backend/tests/test_chip_broker_history_route.py:36/50/63`(mock + assert)、`backend/tests/test_broker_history.py:194/208/221/232/259/285/308/325/326/327/344/345`(直接呼叫)
- **動態用法**:無(已 grep `getattr|hasattr|eval|exec|f"fetch_` 全部 0 命中)

### 前端 hook + api callers
- `useChipData`:唯一 `App.tsx:51`
- `useBrokerHistory`:唯一 `App.tsx:53`
- `api.chipHistory`:`useChipData.ts:40` + 多個 test
- `api.chipBrokerHistory`:`useBrokerHistory.ts:55` + `useBrokerHistory.test.ts` 多處 + `api.test.ts:99`

### 跨 process callers
- 後端 endpoint `/api/chip/{symbol}/history` 與 `/broker_history` 沒有外部 caller(無 mobile / batch script / cron)— grep 整個 repo 確認

## 6. Backward Compat / Migration

- **API**:純 additive,新 query param 都有預設值 → W1/W2 ✓
- **Cache file 路徑**:days==90 沿用既有路徑(W10)、其他 days 加 `_Nd` suffix → 既有 seed 測試零修改;**沒有 orphan 檔**
- **Cache schema (`_cache_version`)**:保留 3,不 bump → test_broker_history.py 的 literal `3` 仍然有效
- **LocalStorage**:`chip_range` 是新 key,沒人讀 → 沒衝突;讀取走 whitelist 避免 garbage
- **Hook signature**:新增 optional `days?` → 既有 caller 零修改
- **Roll back**:revert commit set 即可,disk cache 留下的 `_60d.json` 等檔不會被新代碼讀,留 next-time 清

### UX 成本提示(Plan P1-5)
切換 window 會 invalidate 該 window 對應的 sticky-broker cache → 第一次切到新 window 時,所有已選 broker 需重新打 SecIdAgg。TokenBucket 限速 5 req/s,N 個 broker 大約 `ceil(N/5)` 秒:
- 5 個 broker → ~1 秒
- 20 個 broker(上限)→ ~4 秒
驗證階段觀察是否可接受;若體感太慢,後續改成「單 cache file 存 max(days)、各 window 切片」是 next-time 工作。

## 7. Commit 切分(三類分明,順序執行)

1. `refactor(chip): rename calcMA → rollingMean, add rollingStd helper` 🔵
2. `feat(chip): backend history & broker_history accept optional days param` 🟢
3. `feat(chip): add calcBollinger pure function + BB SVG overlay` 🟢
4. `feat(chip): RangeSelector component (5/10/20/60/180 day radiogroup)` 🟢
5. `feat(chip): wire range selector into App + useChipData + useBrokerHistory` 🟢
6. `chore(chip): DevTools MCP verification screenshots`(完工後)

## 8. 驗證計畫

完成前 gate(auto-verify):
- `cd backend && python -m pytest -q` → **113 + 7(新測)= 120 全綠**(既有 113 個其中 1 個 🔵 1-line patch,其餘 112 不動)
- `cd frontend && npm test` → **211 + 15 it() across 5 新檔 = 226 全綠**(既有 211 個其中 2 個 🔵 1-line patch,其餘 209 不動)
- `cd frontend && npm run build` → tsc -b 無錯
- DevTools MCP 真實環境驗證:
  - dev server 啟動,輸入 2330
  - 確認 K 線渲染 + BB 三條線可見(60d 預設,BB 從第 20 根開始顯示)
  - 切 5 → BB legend 與線都消失(P1-7 / P2-2 fix 驗證)
  - 切 10 → BB legend 仍消失(period 20 > 10)
  - 切 20 → BB legend 仍消失(只有 1 個 non-null mid,P1-7 條件 `>=2`)
  - 切 60 → BB 從第 20 筆開始顯示(共 ~41 個非 null mid)
  - 切 180 → BB 從第 20 筆開始顯示,K 線拉長
  - 鍵盤 ← → 在 RangeSelector 切換,焦點正確跟隨
  - 切到 5 天時,dayTotalLots 顯示要正確(W7 fallback)
  - 切回 60 後 refresh page,localStorage 還原為 60
  - Console 乾淨
  - 截圖:5 / 60 / 180 各一張 + RangeSelector hover/focus 一張 → `docs/specs/2026-06-26-chip-bollinger-and-range/screenshots/`

回頭核 W1-W10 白名單逐條打勾。

## 9. 失敗 routing

- 既有測試紅 → 對照 §E 表 + 4 處 1-line patch 表;若該格說「不變綠」且不在 patch 表,**不准改 assertion**,回 §4 找漏的 default / 漏的 mock
- BB 計算對短窗(days < 21)沒中軌 → 預期行為,整組 BB 隱(包含 legend、線、帶)
- broker_history days=5 但 selected broker 在那 5 天無交易 → 既有「empty list → 0 bar」邏輯沿用
- 5 day 視窗 institutional/margin 全 0(剛好假期段)→ K 線可能變平,InstBarSvg `pMin == pMax` 路徑須確認;這在現有 90 天視窗也可能發生,沒回報 bug → 視為 acceptable

## 10. Spec v1 → v2 變更摘要(回應 Plan review)

| Plan finding | v2 處理 |
|--------------|--------|
| P0-A 漏 `test_chip_broker_history_route.py:66` 等 caller | §5 caller map 補完;§E 表明列、確認 default kwarg 保留行為等價 |
| P0-B cache key 重命名 + version bump 會破 seed-cache 測試 | 改用 **conditional cache key**(days==90 沿用舊路徑)、**不 bump** `_CACHE_VERSION`、零 seed 修改 |
| P1-1 hook signature 破變視為 🔴 才誠實 | 改 hook `days?` optional default 60 → 既有 caller 零修改、徹底 additive |
| P1-3 commit 混合 cache 失效 + 新功能 | 不再 bump version → 此問題消失 |
| P1-4 api.ts days serialisation 模糊 | §C3 明列:undefined 不帶、有值就帶 |
| P1-5 sticky-broker per-window 重抓 UX 成本 | §6 加 UX 成本提示與 next-time 改進方案 |
| P2-1 a11y 用 radiogroup | §C2 改 `role=radiogroup`+`aria-checked`+鍵盤導航,測試覆蓋 |
| P2-2 BB legend period 不足仍顯示 | §C1 加條件 render |
| P2-3 localStorage parse 不檢 whitelist | §C6 加 whitelist check |
