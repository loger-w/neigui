# Chip Bubble Intraday Overlay — Change Spec

**Date**: 2026-06-29
**Type**: /mod(改既有 ChipBubbleView,additive optional prop)
**Goal**: 在「籌碼蝶圖」(Chip Bubble) 背景疊一條 user 所選個股 + 所選交易日的**當日完整分時走勢線**(EOD 1 分 K close price),給 user 看 bubble 落點時對齊「股價當日走勢形狀」。

---

## 1. 成功條件(可驗收)

1. 任一個股 + 交易日,進入泡泡圖 view 時,**背景出現灰色細線**(L1 樣式:純 close-price polyline,`#7c6f55`,strokeWidth=1,fill=none)
2. 線 Y 軸與 bubble Y 軸**共用同一個 sY scale**(price → pixel),即背景線的某個 y pixel 對應的價格,跟同 y pixel 的 bubble 價格一致
3. 線 X 軸是時間(09:00 → 13:30 fixed 範圍),**獨立於** bubble 蝴蝶 X 軸(volume mirror)
4. 線在 bubble **後方**(z-order:grid → time-line → close-dashed → bubbles)
5. 切換 symbol / date / refresh 時,線**正確更新或清空**(seq race 不會把舊 symbol 的線疊到新 symbol)
6. FinMind 無 KBar 資料(假日 / 盤前 / 該日無交易)→ **不畫線、不顯錯誤**,bubble 一切如常
7. FinMind 502 → bubble 部分**仍正常顯示**(intraday 失敗不該破壞 bubble);UI 不顯紅錯誤(降級)
8. 既有 32 個 frontend test file (299 tests) + 223 backend test 仍全綠
9. `npm run build`(tsc -b + vite build)成功

---

## 2. 不能破壞的既有行為(白名單)

| 行為 | 來源 | 驗證方式 |
|------|------|---------|
| Bubble 蝴蝶布局(price 軸 + volume mirror X 軸)pixel 完全不動 | `chip-bubble-svg.tsx:263-280` (Y scale + price/vol axes) | `BubbleChartSvg.test F11` 既有 snapshot — pixel position 必須一致 |
| 選 broker 後 bubble filter / 中央線 / hint 行為 | `chip-bubble-svg.tsx:214-260, :449-461` | F1/F2/F11 既有 tests 必須全綠 |
| 右側 Price bar + buy/sell trade list 行為 | `ChipBubbleView.tsx:160-188` | ChipBubbleView.test F2 必須全綠 |
| `useChipBubble` 介面 `{ data, loading, error, refresh }` | `useChipBubble.ts:19-27` | `useChipBubble.test` 全部 4 個 case 全綠 |
| API client `_cache` TTL 5 min 行為 | `api.ts:7-69` | `api.test.ts` 全綠 |
| Hover tooltip / click select broker | `ChipBubbleView.tsx:65-93` + `chip-bubble-svg.tsx:464-474` | manual smoke test + 既有 ChipBubbleView 測試 |
| Backend 既有 `/api/chip/{symbol}/*` 7 個 endpoint 路徑 + payload(本次新增 /intraday 後變 8 個) | `routes/chip.py` 全部 | 既有 `test_chip_routes.py` 全綠 |
| `_CACHE_VERSION = 3` 不變(避免廢掉既有 8 個 dataset cache) | `services/finmind.py:19` | spec 強調 |

---

## 3. Backward compat / migration

- 純新增,**無破壞性**:
  - 新 endpoint `/api/chip/{symbol}/intraday`(新增,既有無此路徑)
  - 新 hook `useChipIntraday`(新增)
  - 新 component `IntradayLineLayer`(新增)
  - `BubbleChartSvg` props 新增 **optional** `intradayPoints?: IntradayPoint[]`;缺則行為 100% 同既有
  - `ChipBubbleView` 內部呼叫新 hook 並傳入新 prop;此檔對外介面 `{bubbleData, closePrice, symbol}` 不動
- **無 migration 需求**(無 DB / 無資料格式變更)
- **無 cache version bump**(新 cache key 獨立,既有 key 不受影響)

---

## 4. Out of scope(寫進「下次處理」清單)

| 項目 | 為什麼延後 |
|------|----------|
| Polling / 即時 push | user 確認盤後才看,不需 live |
| 高低區間帶(L3 樣式) / 蠟燭 K / 量柱 | L1 已滿足當前需求;升級到 OHLC 視覺另開 /mod。**注意未來加 candle 取 `high/low/open/close`(FinMind TaiwanStockKBar 慣例),不是 `max/min`** |
| toggle 開關「隱藏背景線」 | 預設一直顯示;有人提出再加 |
| X 軸 time tick / crosshair / time tooltip | Workflow 警告:bubble X 軸是 volume,加 time affordance 會誤導 |
| 跨日對比 / N 日 overlay | 只顯示 user 所選的單日 |
| Backend 整合「該日是否有交易」邏輯 | FinMind 回空 list → 前端不畫線即可,不需特別 endpoint |
| Refactor `chip-bubble-svg.tsx`(已 477 行)拆檔 | 屬於「順手」改動,寫進 `docs/refactor-next.md` |

---

## 5. 逐檔 diff(三類分開)

### 🟢 新功能(全新增,加新測試)

#### `backend/services/finmind.py` — 加 method
```python
# 加在 fetch_chip_bubble 後(L237 之後)
async def fetch_chip_intraday(
    self,
    symbol: str,
    date_str: str,
    refresh: bool = False,
) -> dict:
    """當日 1 分 K close-price 時序,供 bubble chart 背景疊圖。

    Schema:
      {symbol, date, fetched_at, points: [{t: "HH:MM", price: float}, ...]}

    points 排序按時間升序;無交易日 / 假日 → points: []。
    """
    cache_key = f"{symbol}_{date_str}_intraday"
    if not refresh:
        cached = self._read_cache(cache_key)
        if cached is not None:
            if not self._is_today(date_str) or not self._is_stale(cached):
                return cached
    return await self._run_once(
        f"intraday_{cache_key}",
        lambda: self._do_fetch_intraday(symbol, date_str, cache_key),
    )

async def _do_fetch_intraday(
    self,
    symbol: str,
    date_str: str,
    cache_key: str,
) -> dict:
    raw = await self._get(
        f"{_FINMIND_BASE}/data",
        {
            "dataset": "TaiwanStockKBar",
            "data_id": symbol,
            "start_date": date_str,
            "end_date": date_str,
        },
    )
    # FinMind TaiwanStockKBar row(實測 EOD schema,Phase 4 commit 1 curl verified):
    #   {date: "YYYY-MM-DD", minute: "HH:MM:SS"(或 "HH:MM" 待確認),
    #    stock_id, open, high, low, close, volume}
    # 注意:date 與 minute 是分開的欄位,不要寫 [11:16] 切 date。
    # 我們取 minute[:5](HH:MM) + close。FinMind 預設按時間升序,保險起見再排一次。
    points = [
        {"t": str(r["minute"])[:5], "price": float(r["close"])}
        for r in raw
        if "minute" in r and "close" in r
    ]
    points.sort(key=lambda p: p["t"])
    result = {
        "symbol": symbol,
        "date": date_str,
        "fetched_at": datetime.now().isoformat(timespec="seconds"),
        "points": points,
    }
    self._write_cache(cache_key, result)
    return result
```

#### `backend/routes/chip.py` — 加 route
```python
@router.get("/api/chip/{symbol}/intraday")
async def get_chip_intraday(
    symbol: str,
    date: str = Query(default=""),
    refresh: bool = Query(default=False),
) -> dict:
    d = date or _today()
    return await get_finmind().fetch_chip_intraday(symbol, d, refresh)
```

#### `backend/tests/test_finmind.py` — 加測試
- `test_fetch_chip_intraday_transforms`:mock FinMind 回 3 row {date, close} → 確認 points 解析正確 + 時間升序
- `test_fetch_chip_intraday_empty_when_no_kbar`:mock 回 `[]` → points = []
- `test_fetch_chip_intraday_cache_hit`:warm cache → 第二次 fetch 0 HTTP calls

#### `backend/tests/test_chip_routes.py` — 加測試
- `test_get_chip_intraday`:route 回 200 + 正確 payload(透過 mock)
- `test_get_chip_intraday_refresh`:`?refresh=true` 傳到 service

#### `frontend/src/lib/chip-data.ts` — 加 types
```typescript
export interface IntradayPoint {
  t: string;       // "HH:MM"
  price: number;
}

export interface ChipIntraday {
  symbol: string;
  date: string;
  fetched_at: string;
  points: IntradayPoint[];
}
```

#### `frontend/src/lib/api.ts` — 加 method
```typescript
// 在 api 物件內加:
chipIntraday(symbol: string, date?: string, refresh?: boolean): Promise<ChipIntraday> {
  const params: Record<string, string> = {};
  if (date) params.date = date;
  if (refresh) params.refresh = "true";
  return get(`${BASE}/chip/${symbol}/intraday`, params);
},
```

#### `frontend/src/hooks/useChipIntraday.ts` — 新檔
```typescript
// 比照 useChipBubble.ts:1-28 形式,query key ["chip-intraday", symbol, date]
// 對外回傳 { data, loading, error, refresh }
// data 為 null 時(loading / error / empty)— 由 ChipBubbleView 自然忽略
```

#### `frontend/src/hooks/useChipIntraday.test.ts` — 加測試
- 比照 useChipBubble.test 的 4 個 case(empty symbol / mount fetch / refresh / error)

#### `frontend/src/lib/intraday-line-svg.tsx` — 新檔
```typescript
// IntradayLineLayer: 純 functional component, memo'd
// Props: { points, yLow, yHigh, paddingLeft, paddingTop, chartWidth, chartHeight }
// 內部:
//   - 過濾掉 price 超出 [yLow, yHigh] 的點(或用 <clipPath>)
//   - sX(t) = paddingLeft + ((minutes(t) - SESSION_START) / SESSION_RANGE) * chartWidth
//     SESSION_START = 9*60 = 540, SESSION_RANGE = (13*60+30) - 9*60 = 270 min
//   - sY(price) = paddingTop + ((yHigh - price) / (yHigh - yLow)) * chartHeight
//   - 渲染 <polyline points="..." stroke="#7c6f55" stroke-width="1" fill="none" pointer-events="none" />
//   - points.length === 0 → 回 null(根本不 render)
//
// NOTE on SESSION 常數:1 分 K 第一根實際標 09:00 或 09:01 視 FinMind 而定;
// 13:25 集合競價段有無 row 也需 Phase 4 commit 1 curl verify。若實測首末點不
// 對齊 09:00/13:30,polyline 兩端會差幾 px(可接受);要 pixel-perfect 可改
// 動態以 min(point.t) / max(point.t) 作 X 軸範圍。
```

#### `frontend/src/lib/intraday-line-svg.test.tsx` — 加測試
- 純函式單測 `pointsToPolyline(points, yLow, yHigh, padding, chartW, chartH)` 輸出正確 SVG points 字串
- empty points → 不 render
- price 超出 [yLow, yHigh] 的點被 clip(或忽略)

#### `frontend/src/lib/chip-bubble-svg.tsx` — 加 optional prop + 內嵌 IntradayLineLayer
```typescript
// BubbleChartProps 加 1 個 optional prop:
intradayPoints?: IntradayPoint[];

// 在 close dashed line 之前(L421)插入:
{intradayPoints && intradayPoints.length > 0 && (
  <IntradayLineLayer
    points={intradayPoints}
    yLow={yLow} yHigh={yHigh}
    paddingLeft={PADDING.left} paddingTop={PADDING.top}
    chartWidth={cW} chartHeight={cH}
  />
)}
```

**Y range hoist 簡化**:不需要 `onYRangeReady` callback。因為 `IntradayLineLayer` 渲染在 `BubbleChartSvg` 內部(同 SVG canvas 內 sibling),`yLow / yHigh / cW / cH` 都是 BubbleChartSvg 內 local 變數,直接傳入子 layer 即可。**無 React warning 風險,無 useEffect 需求。**

**🟢 既有測試評估**:
- F1/F2/F11 既有測試**不傳** `intradayPoints` prop → component 行為不變 → **不會紅**
- 純 additive,歸 🟢 而非 🔴

### 🔴 行為改動(預期讓既有測試紅)

本次**無 🔴**(spec 修正後,所有新增都是 additive optional)。

#### `frontend/src/App.tsx` — mount useChipIntraday + 傳 prop(沿用既有 `useChipBubble` 樣板)
```typescript
// 比照 :128 const bubbleHook = useChipBubble(symbol, date);
const intradayHook = useChipIntraday(symbol, date);

// :343 ChipBubbleView 加新 prop:
<ChipBubbleView
  symbol={symbol}
  bubbleData={bubbleHook.data}
  closePrice={closePrice}
  intradayPoints={intradayHook.data?.points ?? null}
/>
```
**為什麼放在 App.tsx 而不是 ChipBubbleView 內部**:既有設計慣例 — `useChipBubble` 也是在 App.tsx mount,透過 `bubbleData` prop 傳入。ChipBubbleView 是純 presentation,不做 fetch。把 hook 放內部會違反慣例 + 撞既有測試(既有 test 沒包 QueryClientProvider,內 mount hook 會 throw)。

#### `frontend/src/components/ChipBubbleView.tsx` — 加 prop + 透傳給 BubbleChartSvg
```typescript
interface Props {
  bubbleData: ChipBubbleData | null;
  closePrice?: number;
  symbol: string;
  intradayPoints?: IntradayPoint[] | null;  // 新加 optional prop
}

// :147 <BubbleChartSvg ... /> 加 intradayPoints={intradayPoints ?? undefined}
```

**既有 ChipBubbleView.test 評估**:
- F2 sort header 測試 6 個 case 沒傳 `intradayPoints` → optional,值為 undefined → 不畫線 → 既有 assertion 全綠
- 既有測試 **不需要 patch**(prop optional,不傳即 0 影響)
- 此檔對外介面**新增一個 optional prop**,本質仍是 🟢 additive,不算 🔴 行為改

### 🔵 純重構(無)

本次無純重構。`chip-bubble-svg.tsx` 拆檔(已 477 行)的 refactor 寫進 `docs/refactor-next.md`,不在本次處理。

---

## 6. 既有測試影響表

| 測試檔 | 影響 | 處置 |
|--------|------|------|
| `backend/tests/test_finmind.py` | 不會壞 | 新增 3 個 case |
| `backend/tests/test_chip_routes.py` | 不會壞(無新增 mock fixture) | 加 `svc.fetch_chip_intraday = AsyncMock(...)` 進 `mock_fm` fixture + 2 個新 case |
| `backend/tests/test_chip_broker_history_route.py` | 不會壞 | — |
| `backend/tests/*` 其他 | 不會壞 | — |
| `frontend/src/hooks/useChipBubble.test.ts` | 不會壞 | — |
| `frontend/src/components/ChipBubbleView.test.tsx` | 不會壞(intradayPoints 是 optional prop,不傳即 0 影響) | — |
| `frontend/src/App.test.tsx`(若存在) | 不會壞(若有 mock api,新增 chipIntraday mock entry 即可) | — |
| `frontend/src/lib/chip-bubble-svg.test.tsx` | 不會壞 | 新增 1-2 個 intradayPoints case |
| 其他 frontend test | 不會壞 | — |

---

## 7. 新測試清單

### Backend
1. `test_fetch_chip_intraday_transforms` — FinMind row `{date, minute, close, ...}` → points 正確;**fixture row 必須 = §9 R1 紀錄的 golden sample,連 `minute` 欄位實測格式完整保留**(禁止憑想像寫)
2. `test_fetch_chip_intraday_empty_when_no_kbar` — 空 list → points: []
3. `test_fetch_chip_intraday_cache_hit` — warm cache → 0 HTTP
4. `test_fetch_chip_intraday_refresh_bypasses_cache` — `refresh=True` 跳過 cache
5. `test_get_chip_intraday_route_returns_payload` — route 200 + payload shape
6. `test_get_chip_intraday_refresh_param` — `?refresh=true` 傳到 service

### Frontend
1. `useChipIntraday.test` — empty symbol no fetch / mount fetch / refresh / error(4 cases 跟 useChipBubble.test 形對齊)
2. `intraday-line-svg.test` — pure fn 輸出 polyline 字串正確 / empty points 不 render / out-of-range price clip
3. `chip-bubble-svg.test` 新增:傳 `intradayPoints` → 找到 `<polyline>` 出現,stroke=#7c6f55 + strokeWidth=1
4. `chip-bubble-svg.test` 新增:**不傳** intradayPoints → 沒有 polyline(向下相容)
5. `chip-bubble-svg.test` 新增:bubbles 仍在原位置(snapshot pixel match 跟 F11 既有 test 對齊)
6. `api.test` 新增:`chipIntraday URL contains date + refresh` 跟既有 chipBrokerHistory / chipBrokersWindow URL test 同形

---

## 8. Phase 4 TDD 順序(🔵→🔴→🟢)

本次無 🔵 無 🔴(spec 修正後全部 additive)。全部 🟢,按依賴順序:

1. **🟢 Backend service + route + tests**(commit 1):
   - **TDD 順序強制**:**先 curl 真實 EOD row + 紀錄 golden sample 到 spec/memory → 寫 mock fixture(直接 copy golden row)→ 寫紅測 → 實作 → 綠**
   - 新增 `fetch_chip_intraday` + `/api/chip/{symbol}/intraday` + 6 個 backend tests
   - 禁止在 curl 前憑想像寫 fixture(防 P0 schema-misread bug 重蹈)
2. **🟢 Frontend types + api + hook + tests**(commit 2):`IntradayPoint`/`ChipIntraday` types + `api.chipIntraday` + `useChipIntraday` + hook tests
3. **🟢 Frontend SVG layer + tests**(commit 3):`intraday-line-svg.tsx` + pure-fn tests
4. **🟢 BubbleChartSvg 加 optional prop + IntradayLineLayer 整合**(commit 4):chip-bubble-svg.tsx 加 prop + 3 個 chip-bubble-svg 新 test;既有 test 0 修改
5. **🟢 App.tsx 整合(mount hook + 傳 prop) + ChipBubbleView 透傳**(commit 5):App.tsx 加 hook + ChipBubbleView 加 prop;既有 ChipBubbleView.test 0 修改

每個 commit message 前綴 `feat(chip):` + scope。

---

## 9. Risk register

| Risk | 嚴重度 | 緩解 |
|------|------|------|
| FinMind `TaiwanStockKBar` 在 user Sponsor tier 下實際 row schema 跟假設不一致(P0 級已知:date/minute 分開兩欄,不是合併) | P0 | **Phase 4 commit 1 開工前先 curl 2026-06-26(週五 EOD)當 sample → dump 完整 row 到 spec + memory `reference_finmind_intraday_limits.md`**;**curl 必須在盤後跑**(memory L37-44 明示 KBar 盤中 0 rows,盤中跑會空 list 看不出 schema);若 today=2026-06-29 是週一且未過 EOD,改抓 2026-06-26 fallback。**mock test fixture row 必須是實測 row 的 verbatim copy,禁止憑想像寫**(對齊 CLAUDE.md §9 Lessons Learned「FinMind API 接入細節」紀律) |
| `ChipBubbleView.test.tsx` 加 mock 後仍有 missing wrapper 問題(React Query 需要 wrapper) | P1 | beforeEach 加 makeQueryWrapper 同時 mock api;若仍紅看具體錯訊 |
| Layer order 改動意外影響 bubble hit test(invisible overlay rect 必須在最上層) | P2 | IntradayLineLayer 渲染後仍在 close-line 之前,bubble 之後 — overlay rect 順序不變(已是 :464-474 最末);測試覆蓋 |
| Y range hoist `onYRangeReady` callback 在 render 期間 setState → React warning | P2 | 用 useEffect 包,deps [yLow, yHigh];或父層用 ref 拿,不走 state |
| `useChipIntraday` 跟既有 `_cache` 5min TTL + queryClient cache 雙層 cache 衝突 | P3 | 已驗證既有 useChipBubble 同樣雙層 cache 沒問題;比照樣板 |

---

## 10. 命名決定

- API path: `/api/chip/{symbol}/intraday`(沿用 `/api/chip/*` 既有命名空間)
- Cache key: `{symbol}_{date}_intraday`(對齊 `_bubble` 後綴)
- 前端 type: `IntradayPoint` / `ChipIntraday`(對齊既有 `ChipBubbleData` / `ChipHistory`)
- Hook: `useChipIntraday`(對齊 `useChipBubble`)
- Component: `IntradayLineLayer`(不叫 `JiangBoChart` / `RiverChart` — Workflow 驗證標準台股「江波圖」≠ 分時走勢線,避免命名誤導)
- UI 副標(若有 text label):**「當日分時走勢」**;不寫「江波圖」

---

## 11. 驗證 gate(Phase 6-8 對照)

- `cd backend && python -m pytest -q` → 223 + 新 6 = 229 全綠
- `cd frontend && npm test` → 299 + 新 ~10 = ~309 全綠
- `cd frontend && npm run build` → 0 error
- DevTools MCP 截圖:
  - 一個交易日 + 一個股票 → 背景灰線可見、bubble 仍正常
  - 假日 / 該日無交易 → 無背景線、bubble 仍正常(或 empty hint 正常)
  - Refresh → 線正確更新
- Console 乾淨,無 React warning
- 白名單 §2 表逐條打勾
