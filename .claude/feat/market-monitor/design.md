# market-monitor — Phase 1 Design (v3)

> 版本:v3 (2026-06-29)  Changelog 留在檔尾。
> Base SHA: `611d9f0`  Branch: `feat/market-monitor`
> Parent docs: `brainstorm.md` (Phase 0) + `initial-design.md` (2026-06-26 prior art)
> v2 由 round-1 7 條 finding fix;v3 由 `design-review-round-2.json` 5 條 fix(2 P0 + 1 P1 + 2 P2)

---

## 0. 設計目標

- 完成 brainstorm SC-1..5
- 維持與既有 equity / options mode 一致的架構慣例(routes / services / hooks / lib / SVG 純渲染)
- 不引入 visx / d3 等視覺化新依賴(對齊 `lib/chip-svg.tsx` 自寫純算式慣例)
- 後端一次 FinMind fetch 派生所有 view,前端一個 hook 餵兩個元件

---

## 1. Phase 0 開放 question 拍板

| Q | 決定 | 理由 |
|---|---|---|
| Q1 endpoint 數 | **單 endpoint `/api/market/snapshot`**(含 sectors[] for heatmap + leaderboard{gainers/losers/amount/volume_ratio} 各 top 30) | gzip 後估 8-10 KB(全部 ≤ 50 KB 預算),frontend 一個 hook 一個 refetchInterval,排行榜 tab 切換是 UI 邊界不另 fetch;backend 一次 universe cache + 一次 sector merge + 一次 leaderboard sort,簡單 |
| Q2 treemap 算式 | **自寫 squarified treemap**(`lib/heatmap-svg.tsx`)| 對齊 `lib/chip-svg.tsx` 純算式慣例,無新依賴,單測純函式好寫;算法不複雜(Bruls et al. 1999) |
| Q3 市值缺失 | **sector 內 median**(若 sector 全缺則用整盤 median) | median 視覺較公平,tooltip 標「市值估計」 |
| Q4 收盤後 polling | **完全停**(`refetchInterval: false` 當 `is_trading_session=false`)| 簡單,避免假日 24/7 浪費 quota;recovery 用 manual refresh button |

---

## 2. 架構總覽

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (mode='market')                                    │
│                                                              │
│   App.tsx ── ModeSwitch[equity|options|market]              │
│           └── <Suspense>                                     │
│               └── MarketPage (lazy)                          │
│                   ├── MarketHeader (last_tick, banner, refresh)│
│                   ├── MarketHeatmap (70%)  ◀─┐               │
│                   └── MarketLeaderboard (30%) │ same hook    │
│                       └── 3-tab: gainers/amount/volume_ratio  │
│                                                 │            │
│   useMarketSnapshot() ─── TanStack Query ──────┘            │
│       refetchInterval: is_trading_session ? 2500 : false     │
│       retry: 1, timeout: 5000                                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼ GET /api/market/snapshot
┌─────────────────────────────────────────────────────────────┐
│  Backend (FastAPI)                                           │
│                                                              │
│   routes/market.py                                           │
│       GET /api/market/snapshot                               │
│         └── services.finmind_realtime.fetch_market_snapshot()│
│                                                              │
│   services/finmind_realtime.py                               │
│     fetch_market_snapshot(refresh=False) -> MarketSnapshot   │
│       1. parallel fetch:                                     │
│          - tick_snapshot universe (5s TTL on disk)           │
│          - sector_map_cache    (24h TTL on disk)             │
│          - market_value_cache  (24h TTL on disk)             │
│       2. merge & dedup sectors (E4)                          │
│       3. compute trading_session flag                        │
│       4. group by sector → SectorAgg                         │
│       5. compute leaderboards (4 lists × 30)                 │
│       6. return MarketSnapshot                               │
│                                                              │
│   services/trading_session.py (new)                          │
│     is_in_session(now: datetime, last_tick: datetime|None)   │
│        -> (in_session: bool, lag_seconds: int|None)          │
│                                                              │
│   utils/cache.py (existing)                                  │
│     atomic_write_json / read_json / _CACHE_VERSION_REALTIME=1│
└─────────────────────────────────────────────────────────────┘
                       │
                       ▼ Bearer token + Authorization
            ┌──────────────────────────┐
            │   FinMind v4 API         │
            │   - taiwan_stock_tick_snapshot (parallel) │
            │   - /data?dataset=TaiwanStockInfo (daily) │
            │   - /data?dataset=TaiwanStockMarketValue (daily)│
            └──────────────────────────┘
```

---

## 3. 檔案組織

### Backend(新增 / 擴充)

| 檔案 | 動作 | 責任 |
|---|---|---|
| `backend/services/finmind_realtime.py` | **新增** | snapshot fetch + parse + sector merge + dedup + leaderboard 計算;`_CACHE_VERSION_REALTIME = 1`;sibling 於 `finmind.py` / `finmind_options.py` |
| `backend/services/trading_session.py` | **新增** | `is_in_session(now, last_tick)` 純函式;對齊 `lib/*-svg` 慣例(純算式無 IO) |
| `backend/routes/market.py` | **新增** | `GET /api/market/snapshot`;遵守既有 `routes/options.py` error contract(`HTTPException(status_code, detail={"error": "<code>"})`)|
| `backend/main.py` | **延伸** | `app.include_router(market.router, prefix="/api/market")` |
| `backend/services/finmind.py` | **不動** | 不擴充,realtime 完全 sibling;避免 2050 行檔再長 |
| `backend/tests/test_market_routes.py` | **新增** | route + service 整測 |
| `backend/tests/test_finmind_realtime.py` | **新增** | service 單測(mock _get) |
| `backend/tests/test_trading_session.py` | **新增** | 純函式單測 |

### Frontend(新增 / 擴充)

| 檔案 | 動作 | 責任 |
|---|---|---|
| `frontend/src/components/MarketPage.tsx` | **新增** | lazy shell;Suspense fallback 用既有 `<Spinner />` 或 skeleton;掛 hook |
| `frontend/src/components/MarketHeader.tsx` | **新增** | header bar:title + last_tick + banner + manual refresh + status pill |
| `frontend/src/components/MarketHeatmap.tsx` | **新增** | 純掛 DOM,計算交給 `lib/heatmap-svg.tsx`;hover state local;onClick → onSymbolPick(stockId) prop |
| `frontend/src/components/MarketLeaderboard.tsx` | **新增** | 3-tab(`Tabs` from `components/ui/tabs.tsx`);三個 row table;onClick row → onSymbolPick |
| `frontend/src/hooks/useMarketSnapshot.ts` | **新增** | TanStack `useQuery`;對外 shape `{ data, loading, error, refresh, lastUpdated, isStale, isTradingSession }` |
| `frontend/src/lib/heatmap-svg.tsx` | **新增** | squarified treemap 純算式 + 顏色映射 + SVG render helper(無 React state)|
| `frontend/src/lib/market-types.ts` | **新增** | API contract type:`MarketSnapshot` / `Sector` / `StockTile` / `Leaderboards` |
| `frontend/src/lib/market-api.ts` | **新增** | v3 F11 — `fetchMarketSnapshot(refresh: boolean)` 直接走 `fetch()` **不經 `__apiGet`**;避開 `lib/api.ts` 內建 5-min `_cache` 與 polling 相撞(TanStack Query 自身已 dedup) |
| `frontend/src/lib/api.ts` | **不動** | v3 F11 — 移除原 v2 計劃的 fetchMarketSnapshot 擴充,改放 `market-api.ts` sibling |
| `frontend/src/App.tsx` | **延伸** | `Mode` union 加 `"market"`;`<MarketPage />` lazy import + Suspense + `hidden={mode !== "market"}` 慣例;`onSymbolPick` callback 從 MarketPage 接 stockId → `setMode("equity") + setSymbol(stockId)` |
| `frontend/src/components/ModeSwitch.tsx` | **延伸** | 第三 button「大盤」+ `Mode` union 擴 "market";保留既有 2 button + `aria-current="page"` pattern |
| `frontend/src/components/ModeSwitch.test.tsx` | **延伸** | F7 修:補第三 button render / aria-current / onChange 測試,既有 2 button 測試不破(TDD 先紅再綠) |
| `frontend/src/components/MarketPage.test.tsx` | **新增** | RTL — render + 三個 sub-component mount |
| `frontend/src/components/MarketHeatmap.test.tsx` | **新增** | RTL — hover tooltip + onClick callback |
| `frontend/src/components/MarketLeaderboard.test.tsx` | **新增** | RTL — 3-tab + 排序 |
| `frontend/src/lib/heatmap-svg.test.ts` | **新增** | 純函式單測(tile layout + color bin) |
| `frontend/src/hooks/useMarketSnapshot.test.ts` | **新增** | hook 單測(refetchInterval / retry / stale flag) |

**統計**:Backend 4 個 source + 3 test = 7 file 新增 / 1 modify;Frontend 7 個 source + 5 test = 12 file 新增 / 3 modify。**總 ~ 22 個改動**(完整 L 級)。

---

## 4. API contract

### `GET /api/market/snapshot`

**Query 參數**:`refresh: bool = False`(query `?refresh=true` 跳 cache 重抓 FinMind,對齊既有慣例 §4)

**Success response**(`200`):
```json
{
  "as_of": "2026-06-29T16:15:23+08:00",
  "last_tick": "2026-06-29T13:30:00",
  "is_trading_session": false,
  "stale": false,
  "lag_seconds": 9923,
  "sectors": [
    {
      "id": "半導體業",
      "name": "半導體業",
      "member_count": 166,
      "avg_change_rate": -0.72,
      "total_amount": 87540000000,
      "stocks": [
        { "stock_id": "2330", "name": "台積電", "change_rate": 1.92, "total_amount": 35923705000, "market_value": 60681745956780 }
      ]
    }
  ],
  "leaderboards": {
    "gainers": [{ "stock_id": "...", "name": "...", "change_rate": 9.96, "total_amount": 1663600000, "sector": "..." }],
    "losers":  [/* top 30 by change_rate asc */],
    "amount":  [/* top 30 by total_amount desc */],
    "volume_ratio": [/* top 30 by volume_ratio desc */]
  }
}
```

**Error contract**(對齊既有 FastAPI `detail.error` 慣例):
- `502 detail={"error": "finmind_unreachable"}` — upstream 全掛且無 disk cache
- `503 detail={"error": "snapshot_unavailable"}` — service 尚未 ready(極少出現)
- `200 + stale=true` — 部分 fetch 失敗但有 disk cache 兜底(stale fallback)

**Payload size 目標**:gzip 前 ≤ 50 KB(F3 修正:用真實 byte 估)。

**每筆 stock JSON object 真實大小**(以 2330 為例):
```
{"stock_id":"2330","name":"台積電","change_rate":1.92,"total_amount":35923705000,"market_value":60681745956780}
```
測量結果(`wc -c`):~ 115-120 bytes(中文 UTF-8 3B/字 + 13 位金額)。

**估算**:
- TaiwanStockInfo `industry_category` 監管 cardinality ≈ 28 類(實際 sector 數)
- `_HEATMAP_STOCKS_CAP_PER_SECTOR = 30`(從 v1 的 50 降到 30 保守)
- sectors[] = 28 × (header ~ 80B + 30 stocks × 119B) ≈ 28 × 3650 ≈ **102 KB raw**
- leaderboards 4 × 30 row × 145B(加 volume_ratio + sector 名) ≈ **17 KB raw**
- 總 raw ≈ **119 KB**;gzip 18%(中文 + 重複 key 名)≈ **22 KB** ✓

**Phase 3 / Phase 6 measurement gate**:Phase 3 完成後加 `tests/test_market_routes.py::test_payload_size_under_budget` 跑 mock + `len(json.dumps(payload).encode()) < 50000` assert;Phase 6 真實環境跑 `curl -s ... | gzip | wc -c` 算 over-the-wire 真值。預估若爆 SC-1 → 降 cap 到 20/sector 並 amend design v3。

**Frontend 預期**:單一 `fetch` 拿回後,heatmap 用 `sectors[]`,leaderboard 用 `leaderboards`,無需 client side filter / sort。

---

## 5. Backend 細節設計

### 5.1 `services/finmind_realtime.py` 流程

```python
# Pseudocode shape (Phase 2 才寫真實 signature)

_CACHE_VERSION_REALTIME = 1
_UNIVERSE_TTL_SECONDS = 5
_SECTOR_MAP_TTL_HOURS = 24
_MARKET_VALUE_TTL_HOURS = 24
_HEATMAP_STOCKS_CAP_PER_SECTOR = 30  # v3 F8 — 對齊 §4 measurement(原 50,降到 30 保守)
_LEADERBOARD_SIZE = 30

async def fetch_market_snapshot(refresh: bool = False) -> dict:
    # 1. 並發三件 fetch (universe = live,後兩個 daily cache)
    universe, sector_map, mv_map = await asyncio.gather(
        _fetch_universe(refresh),
        _fetch_sector_map(),     # auto 24h cache, no refresh param needed
        _fetch_market_value_map(),
    )

    # 2. dedup sector(E4):取 type="twse" + 最新 date 那筆當 primary
    primary_sector = _dedup_sector_map(sector_map)  # stock_id -> sector_name

    # 3. trading session 偵測(最新 tick + 現在時間)
    last_tick = _max_tick_date(universe)
    in_session, lag = is_in_session(now=datetime.now(), last_tick=last_tick)

    # 4. 派生 view
    sectors = _group_by_sector(
        universe, primary_sector, mv_map,
        cap_per_sector=_HEATMAP_STOCKS_CAP_PER_SECTOR,
    )
    leaderboards = _compute_leaderboards(universe, primary_sector, size=_LEADERBOARD_SIZE)

    return {
        "as_of": datetime.now().isoformat(),
        "last_tick": last_tick.isoformat() if last_tick else None,
        "is_trading_session": in_session,
        "stale": False,
        "lag_seconds": lag,
        "sectors": sectors,
        "leaderboards": leaderboards,
    }
```

### 5.2 Cache 策略

| Key prefix | Source dataset | TTL | 失效 |
|---|---|---|---|
| `realtime_universe` | `taiwan_stock_tick_snapshot`(無 data_id) | **5 秒**(snapshot live) | `_is_stale` 比較 `fetched_at` |
| `realtime_sector_map` | `/data?dataset=TaiwanStockInfo` | **24 小時** | 同日 cache hit |
| `realtime_mv_map` | `/data?dataset=TaiwanStockMarketValue`(start_date=end_date=T-1 trading day)| **24 小時** | 同日 cache hit |

**Concurrency dedup**:`_run_once("market_snapshot", fn)` inflight + 同 key dedup(對齊 `finmind.py` 樣板)。

**Stale fallback**(E7):任一 FinMind fetch 失敗 → catch `httpx.HTTPError`,若有 disk cache 兜底 + payload `stale=true`;若無 cache → 502。

### 5.3 Sector dedup(E4)詳細(v2 — F6 修 deterministic)

Probe 觀察:`TaiwanStockInfo?data_id=2330` 回 2 rows(半導體業 + 電子工業),`type` 都是 `twse`,`date` 可能不同。

**v1 規則(reject)**:「取最新 date 第一筆」是 **non-deterministic**,depends on FinMind 回傳順序 / Python sort stability;2330 可能跑出「電子工業」而非預期「半導體業」,跨跑次不穩。

**v2 deterministic 規則**:

```python
# services/finmind_realtime.py

_PRIMARY_INDUSTRY_OVERRIDE: dict[str, str] = {
    # Phase 1 預載 top 權值股已知主要產業(對齊 user 直覺)
    "2330": "半導體業",
    "2454": "半導體業",
    "2317": "其他電子業",
    "2308": "電子零組件業",
    "2382": "電子工業",
    "2412": "通信網路業",
    "2882": "金融保險業",
    "2891": "金融保險業",
    "1216": "食品工業",
    "1101": "水泥工業",
    # Phase 0b-2 probe 後 amend 擴充
}

def _dedup_sector_map(rows: list[dict]) -> dict[str, str]:
    """Build stock_id -> primary industry_category (deterministic).
    
    Tie-breaker order:
    1. _PRIMARY_INDUSTRY_OVERRIDE 命中直接取
    2. filter type in ("twse", "tpex")
    3. sort by (date desc, industry_category asc) via stable two-pass
    4. 取 first row per stock_id
    """
    out: dict[str, str] = {}
    filtered = [r for r in rows if r.get("type") in ("twse", "tpex")]
    # v3 F9 — Python stable sort 標準 two-pass:secondary key ASC 先,primary key DESC 後
    sorted_rows = sorted(
        sorted(filtered, key=lambda r: r.get("industry_category") or ""),
        key=lambda r: r.get("date") or "",
        reverse=True,
    )

    for row in sorted_rows:
        sid = row.get("stock_id")
        if not sid or sid in out:
            continue
        # override 命中優先(同一 stock_id 在多 row 期間結果一致)
        if sid in _PRIMARY_INDUSTRY_OVERRIDE:
            out[sid] = _PRIMARY_INDUSTRY_OVERRIDE[sid]
        else:
            out[sid] = row.get("industry_category") or "其他"
    return out
```

**Phase 0b-2 probe 待驗**(brainstorm.md §6):
- 全市場 cardinality:多少 stock_id 有 multi-row?
- 若 multi-row > 30% → 擴 `_PRIMARY_INDUSTRY_OVERRIDE` table 到 top 50 權值股或改 strategy
- 若 < 5% → 純字典序 tie-breaker 就夠

**Phase 0b probe 後可 amend**:在 design.md changelog v3 標 override 擴充 / strategy 調整。

### 5.4 Trading session 偵測(`services/trading_session.py`)

純函式(無 IO):
```python
TPE_TZ = timezone(timedelta(hours=8))
SESSION_OPEN = time(9, 0)
SESSION_CLOSE = time(13, 30)

def is_in_session(now: datetime, last_tick: datetime | None) -> tuple[bool, int | None]:
    """Return (in_session, lag_seconds).
    
    in_session = (weekday Mon-Fri) AND (TPE 09:00 ≤ now ≤ 13:30) AND
                 (last_tick 存在 AND lag ≤ 60s)
    lag_seconds = (now - last_tick).total_seconds() if last_tick else None
    """
    if last_tick is None:
        return False, None
    lag = int((now - last_tick).total_seconds())
    weekday = now.astimezone(TPE_TZ).weekday()
    t = now.astimezone(TPE_TZ).time()
    in_window = weekday < 5 and SESSION_OPEN <= t <= SESSION_CLOSE
    in_session = in_window and lag <= 60
    return in_session, lag
```

**為何不查 `trading_calendar`**:trading_calendar 給「是不是交易日」,但已含週末 + 補班日。`is_in_session` 在 Phase 1 用 `weekday < 5` 的簡化版本(假日 / 補班這類 edge,Phase 0b-4 probe 確認 snapshot 行為後 Phase 2 才決定要不要呼叫 `trading_calendar.get_trading_days`)。

### 5.5 Leaderboard 計算(v2 — F5 修)

純 Python:
```python
def _compute_leaderboards(universe, primary_sector, size=30):
    enriched = [
        {**row, "sector": primary_sector.get(row["stock_id"], "其他"), "name": ...}
        for row in universe
    ]
    gainers = sorted(enriched, key=lambda r: r["change_rate"], reverse=True)[:size]
    losers = sorted(enriched, key=lambda r: r["change_rate"])[:size]
    amount = sorted(enriched, key=lambda r: r["total_amount"], reverse=True)[:size]
    vr = sorted(enriched, key=lambda r: r.get("volume_ratio") or 0, reverse=True)[:size]
    return {"gainers": _trim(gainers), "losers": _trim(losers),
            "amount": _trim(amount), "volume_ratio": _trim(vr)}

def _trim(rows):
    """LeaderboardRow:含 volume_ratio,讓量比 tab 顯示數值差距(F5)。"""
    return [{
        "stock_id": r["stock_id"],
        "name": r["name"],
        "change_rate": r["change_rate"],
        "total_amount": r["total_amount"],
        "volume_ratio": r.get("volume_ratio"),  # nullable
        "sector": r["sector"],
    } for r in rows]
```

---

## 6. Frontend 細節設計

### 6.1 Mode 整合(`App.tsx`、`ModeSwitch.tsx`)(v2 — F2 修)

```ts
// components/ModeSwitch.tsx
export type Mode = "equity" | "options" | "market"

// App.tsx 內 — 對齊既有 inline pattern(App.tsx:67-71),不用 custom hook
const [mode, setMode] = useState<Mode>(() =>
  (localStorage.getItem("mode") as Mode) || "equity"
)
useEffect(() => { localStorage.setItem("mode", mode); }, [mode])

// symbol 維持非持久(既有設計,App.tsx:73)
const [symbol, setSymbol] = useState("")

const handleSymbolPick = useCallback((sid: string) => {
  setMode("equity")
  setSymbol(sid)
}, [])

// render:
<ModeSwitch value={mode} onChange={setMode} />
<div hidden={mode !== "market"}>
  <Suspense fallback={<MarketPageFallback />}>
    <MarketPage
      isActive={mode === "market"}
      onSymbolPick={handleSymbolPick}
    />
  </Suspense>
</div>
```

注意:
- `isActive` prop 傳入 MarketPage(F4 修),內部交給 `useMarketSnapshot(isActive)`,mode 切走自動暫停 polling
- `Suspense fallback` 用簡單 skeleton 或既有 spinner(對齊 OptionsPage Suspense 慣例)

ModeSwitch 3 button(對齊現況「個股」/「選擇權」兩字風格,不混長詞):
- `個股`     (equity)
- `選擇權`   (options)
- `大盤`     (market) — **新增**

### 6.2 `hooks/useMarketSnapshot.ts`(v2 — F1 + F4 修)

```ts
export type UseMarketSnapshot = {
  data: MarketSnapshot | null
  loading: boolean
  error: string | null
  refresh: () => void
  lastUpdated: string | null
  isStale: boolean
  isTradingSession: boolean
}

export function useMarketSnapshot(enabled: boolean): UseMarketSnapshot {
  const forceRefreshRef = useRef(false)

  const { data, isFetching, error, refetch } = useQuery<MarketSnapshot, Error>({
    queryKey: ["market", "snapshot"],
    queryFn: async () => {
      const force = forceRefreshRef.current
      forceRefreshRef.current = false
      return fetchMarketSnapshot(force)  // force=true → URL ?refresh=true
    },
    enabled,
    refetchInterval: (query) => {
      const d = query.state.data as MarketSnapshot | undefined
      return d?.is_trading_session ? 2500 : false
    },
    refetchIntervalInBackground: false,  // 切瀏覽器 tab 暫停
    retry: 1,
    staleTime: 0,
  })

  return {
    data: data ?? null,
    loading: isFetching,           // 對齊既有 hook 慣例(useOptionsLargeTraders.ts)
    error: error ? error.message : null,
    refresh: () => {
      forceRefreshRef.current = true
      refetch()
    },
    lastUpdated: data?.last_tick ?? null,
    isStale: data?.stale ?? false,
    isTradingSession: data?.is_trading_session ?? false,
  }
}
```

**API contract 對齊**:
- 回傳 shape `{ data, loading, error, refresh, ...extras }`(CLAUDE.md §3)
- `loading = isFetching`(非 `isLoading`)— 對齊 `useOptionsLargeTraders.ts` 樣板
- `refresh()` 走 `forceRefreshRef` pattern,確實會把 `?refresh=true` 帶到 backend(CLAUDE.md §4)
- `enabled` prop:caller(MarketPage)傳 `mode === "market"`,mode 切走 hook 暫停 polling(F4 修)
- `refetchIntervalInBackground: false`:額外擋瀏覽器 tab 切走的情境

### 6.3 `lib/heatmap-svg.tsx`(純算式)

```ts
// Squarified treemap (Bruls et al. 1999)
export type TileLayout = {
  x: number; y: number; w: number; h: number;
  stockId: string; name: string; changeRate: number;
  marketValue: number; totalAmount: number;
}

export type SectorGroupLayout = {
  x: number; y: number; w: number; h: number;
  id: string; name: string; tiles: TileLayout[];
  avgChangeRate: number;
}

export function layoutHeatmap(
  sectors: Sector[],
  width: number,
  height: number,
): SectorGroupLayout[] {
  // 1. outer treemap: sectors size = sum of stock.market_value (or 1 if all missing)
  // 2. inner treemap per sector: stock.market_value (或 sector median if missing — E2)
  // 算式: 標準 squarified;細節 Phase 2 spec
}

export function colorForChange(changeRate: number): string {
  // Bull = 紅 / Bear = 綠(台股慣例,CLAUDE.md §3)
  // bins: > 7 / > 3 / > 1 / > 0 / 0 / < 0 / < -1 / < -3 / < -7
  // 對應 9 階紅綠灰
}
```

`MarketHeatmap.tsx` 元件:
- `useRef` 量 container size(`useResizeObserver` 對齊 chip-kline-svg.tsx pattern)
- 計算 `layoutHeatmap(sectors, w, h)`
- render `<svg>` + `<rect>` × N + `<text>` × N
- hover state local(用 React.useState 跟 `onMouseEnter` / `onMouseLeave`)
- click → `onSymbolPick(stockId)`

### 6.4 `MarketLeaderboard.tsx`

用既有 `components/ui/tabs.tsx`(Radix):
- 3 個 TabsTrigger:`漲跌幅` / `大量單` / `量比`
- TabsContent 對應 table
- 漲跌幅 tab 顯示 top 15 漲 + top 15 跌(合 30 行,中間放分隔)
- 其他兩 tab top 30
- 每 row 點 click → `onSymbolPick`

### 6.5 `MarketHeader.tsx`

橫 bar:
- 左:title「大盤掃描」+ last_tick + lag pill(綠=即時 / 黃=stale 30-60s / 紅=stale 60s+)
- 右:狀態 badge(「盤中」/「已收盤」/「假日」)+ manual refresh button
- 中段:`stale=true` 顯示 banner「資料停滯 X 秒」;`!is_trading_session` 顯示「已收盤,顯示 HH:MM 收盤資料」

### 6.6 `MarketPage.tsx` layout(CSS Grid)

```tsx
// v3 F4-verify — 明示 hook call,close 掉 callgraph 不確定性
export function MarketPage({ isActive, onSymbolPick }: MarketPageProps): ReactElement {
  const { data, refresh, lastUpdated, isStale, isTradingSession, loading, error } =
    useMarketSnapshot(isActive);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[7fr_3fr] gap-3 h-full">
      <div className="contents lg:col-span-2 lg:flex">
        <MarketHeader
          lastUpdated={lastUpdated}
          isStale={isStale}
          isTradingSession={isTradingSession}
          lagSeconds={data?.lag_seconds ?? null}
          onRefresh={refresh}
        />
      </div>
      <MarketHeatmap
        sectors={data?.sectors ?? []}
        onSymbolPick={onSymbolPick}
      />
      <MarketLeaderboard
        leaderboards={data?.leaderboards ?? null}
        onSymbolPick={onSymbolPick}
      />
    </div>
  );
}
```

桌面:左 70% heatmap + 右 30% leaderboard。手機:stack(SC-3 接受度測過)。

### 6.7 `lib/market-api.ts`(v3 F11 — 為何 sibling 不擴 api.ts)

問題:`lib/api.ts` 的 `__apiGet` 內建 `_cache: Map` + `CACHE_TTL = 5 * 60 * 1000`(5 分鐘)。只認 `params.refresh === "true"` 才 invalidate。若 `fetchMarketSnapshot(false)` 走 `__apiGet`:
- T=0:cache miss → fetch backend → cache set
- T=2.5s:TanStack queryFn 觸發 → `__apiGet` cache hit → 回上一份 → **UI 凍結 5 分鐘**

TanStack Query 自身已 dedup 同 queryKey 並發,所以 client-side 不再需要第二層 5 分鐘 cache。Polling 要的是「每次都打 backend、backend 自己決定回 cache 或 fresh」,5 分鐘的 client 層擋這個邏輯。

設計:
```ts
// frontend/src/lib/market-api.ts
import type { MarketSnapshot } from "./market-types"

const BASE = "/api/market"

export async function fetchMarketSnapshot(refresh: boolean): Promise<MarketSnapshot> {
  const url = new URL(`${BASE}/snapshot`, window.location.origin)
  if (refresh) url.searchParams.set("refresh", "true")
  const resp = await fetch(url.toString())
  if (!resp.ok) {
    const body = await resp.json().catch(() => null)
    throw new Error(body?.detail?.error ?? `HTTP ${resp.status}`)
  }
  return resp.json()
}
```

這跟 `__apiGet` 的差別:沒有 `_cache` / 沒有 `_seqMap`。其他規範對齊:
- error JSON shape 解 `body.detail.error`(CLAUDE.md §4)
- BASE 用 `/api/market`(對齊 vite proxy 規則)
- `URL + searchParams` 處理 query 字串(對齊 api.ts:38-43)

未來其他即時 endpoint(篩選器 / 監控)走 market-api.ts 擴充,不污染 `__apiGet` cache。

---

## 7. Data flow(loop)

```
T=0 (page load):
  useMarketSnapshot mount → useQuery fetch
  → backend route → service.fetch_market_snapshot
    → parallel fetch universe / sector_map / mv_map
    → dedup / group / sort
    → response 25 KB gzip
  ← frontend → cache populated, render heatmap + leaderboard
  
T=2.5s (refetchInterval):
  → backend route again
  → service: universe cache hit if < 5s, else fetch FinMind
  → sector/mv cache hit (24h)
  → 25 KB response
  ← frontend → diff render

When data.is_trading_session = false:
  refetchInterval returns false → polling 停
  Manual refresh button onClick → q.refetch() → 一次 fetch

When upstream fails:
  service catch → if disk cache → stale=true payload
                → else 502 detail.error = "finmind_unreachable"
  frontend → if 502 → error banner;if stale=true → 黃色 banner
```

---

## 8. SC 對應設計章節

| SC | 設計章節 |
|---|---|
| **SC-1** | §4 API contract + §5 backend 細節 |
| **SC-2** | §6.3 heatmap-svg + §6.6 layout |
| **SC-3** | §6.4 leaderboard component |
| **SC-4** | §6.1 mode 整合 + §3 frontend file structure |
| **SC-5** | §5.4 trading session + §6.2 useMarketSnapshot hook + §6.5 header banner |

---

## 9. 錯誤 / 異常路徑

| 情境 | Backend | Frontend |
|---|---|---|
| FinMind 全掛無 cache | 502 `{"error":"finmind_unreachable"}` | error banner「資料源無法連線」+ retry button |
| FinMind 全掛有 cache | 200 `stale=true` | 黃色 banner「資料 X 秒未更新」+ 數據照常 render |
| FinMind universe 掛但 sector/mv ok | 502(無 universe 無資料可顯示)| 同上 |
| FinMind sector/mv 掛但 universe ok | 200 sectors=[{ id: "其他", stocks: [...] }] | 全部歸「其他」一欄,user 看得到 |
| Snapshot 1.6s outlier | httpx 內部 retry(本身 timeout 5s)| TanStack retry × 1 |
| TPE 13:30 後 | `is_trading_session=false`,payload 照常 | 「已收盤」狀態 + 停 polling |
| 假日 / 週末 | `is_trading_session=false`(weekday 過濾)| 「無交易日」狀態 + 停 polling |
| User 切走 market mode | hidden 不重新 mount;polling 持續(背景) | hook 仍 active 但 user 看不到 |

**Background polling 防護**:用 TanStack `refetchIntervalInBackground: false` 切到背景 tab 暫停。

---

## 10. Connection points(interface signatures)

```ts
// Backend payload
type MarketSnapshot = {
  as_of: string;          // ISO datetime
  last_tick: string | null;
  is_trading_session: boolean;
  stale: boolean;
  lag_seconds: number | null;
  sectors: Sector[];
  leaderboards: Leaderboards;
}
type Sector = {
  id: string;
  name: string;
  member_count: number;
  avg_change_rate: number;
  total_amount: number;
  stocks: StockTile[];
}
type StockTile = {
  stock_id: string;
  name: string;
  change_rate: number;       // -100 ~ +100 (%)
  total_amount: number;
  market_value: number | null;  // null when missing → §1 Q3 fallback
}
type Leaderboards = {
  gainers: LeaderboardRow[];
  losers: LeaderboardRow[];
  amount: LeaderboardRow[];
  volume_ratio: LeaderboardRow[];
}
type LeaderboardRow = {
  stock_id: string;
  name: string;
  change_rate: number;
  total_amount: number;
  volume_ratio: number | null;   // v2 F5 — 量比 tab 顯示 1.14x 格式
  sector: string;
}

// Frontend Component props
type MarketPageProps = { isActive: boolean; onSymbolPick: (sid: string) => void }
type MarketHeatmapProps = { sectors: Sector[]; onSymbolPick: (sid: string) => void }
type MarketLeaderboardProps = { leaderboards: Leaderboards | null; onSymbolPick: (sid: string) => void }
type MarketHeaderProps = {
  lastUpdated: string | null
  isStale: boolean
  isTradingSession: boolean
  lagSeconds: number | null
  onRefresh: () => void
}

// Hook
function useMarketSnapshot(enabled: boolean): UseMarketSnapshot   // v2 F4 — caller 傳 mode === 'market'
```

---

## 11. 實作順序(Phase 3 TDD 進場順序)

1. `services/trading_session.py` + test_trading_session.py(純函式,獨立,先寫)
2. `services/finmind_realtime.py` + test_finmind_realtime.py(`fetch_market_snapshot` + dedup + leaderboard)
3. `routes/market.py` + test_market_routes.py(route 整測,mock service)
3a. **`test_market_routes.py::test_payload_size_under_budget`**(v3 F10 — 跟 route test 一起 ship,mock 28 sectors × 30 stocks fixture,assert `len(json.dumps(payload).encode()) < 50000`;Phase 6 真實環境再驗 over-the-wire 真值)
4. `main.py` + register router(配 step 3 收尾)
5. `frontend/src/lib/market-types.ts`(types,先寫好給後續 component 引用)
6. `frontend/src/lib/heatmap-svg.tsx` + test(純算式)
7. **`frontend/src/lib/market-api.ts`(v3 F11 — 新檔 sibling,不擴 `lib/api.ts`)**:`fetchMarketSnapshot(refresh: boolean)` 直接 `fetch()` 避開 `__apiGet` 5-min cache
8. `frontend/src/hooks/useMarketSnapshot.ts` + test
9. `frontend/src/components/MarketHeader.tsx`
10. `frontend/src/components/MarketHeatmap.tsx` + test
11. `frontend/src/components/MarketLeaderboard.tsx` + test
12. `frontend/src/components/MarketPage.tsx` + test
13. **`ModeSwitch.test.tsx` 先補第三 button 測試 → 跑 → 紅 → `ModeSwitch.tsx` 擴 3 button → 跑 → 綠**(TDD,F7 修)
14. `frontend/src/App.tsx` 接 market mode + onSymbolPick + isActive prop

每件做完就 commit(三類 tag),不會堆。

---

## 12. Phase 0b probe 後可能 amend

下個交易日 probe 結果回來,以下章節可能 amend(在 design.md changelog 記):
- §5.4 `is_in_session` 內 weekday 過濾規則(若 0b-4 證明假日有 wall-clock 行為差異)
- §5.3 sector dedup `type` 過濾(若 0b-2 證明 multi-row 比例高 → 需更細策略)
- §5.2 universe TTL(若 0b-1 證明開盤熱門時段 tick 推進 ~ 1 秒,TTL 縮短到 1.5 秒)

---

## 13. Known Risks(進入 Phase 2 前承認)

- **R-D1** payload size 上限的 trim 策略可能漏掉小市值飆股(被 cap 砍掉)→ MarketLeaderboard 可彌補(飆股一定上 leaderboard)
- **R-D2** TanStack `refetchInterval` 改成動態 callback(看 data.is_trading_session)是較新 API(v5+),需確認專案版本支援
- **R-D3** Squarified treemap 純算式邊界 case(width × height 比例極端、tiles 太多)需單測涵蓋
- **R-D4** ModeSwitch 從 2-button 改 3-button,既有 `ModeSwitch.test.tsx` 必須更新(對齊 SC-4)

---

## Changelog

- **v1** (2026-06-29):初版,基於 brainstorm.md + initial-design.md;4 個 Phase 0 開放 question 拍板;架構 / 檔案 / 介面 / data flow / 錯誤路徑 / Phase 0b amend 預留窗口
- **v3** (2026-06-29):`design-review-round-2.json` 5 條 finding 全 accepted 後 amend:
  - **F8** §5.1 `_HEATMAP_STOCKS_CAP_PER_SECTOR` 50 → 30,對齊 §4 measurement(F3 後續 cleanup)
  - **F9** §5.3 sector dedup sort body 改 deterministic two-pass(secondary ASC + primary DESC reverse=True),刪 negative trick hedge
  - **F10** §11 step 3a 加 `test_payload_size_under_budget` 跟 route test 一起 ship
  - **F4-verify** §6.6 snippet 補 `useMarketSnapshot(isActive)` hook call,close callgraph 不確定性
  - **F11**(main agent self-found, P0)`lib/api.ts` 內建 5-min `_cache` 撞 polling;新增 `frontend/src/lib/market-api.ts` sibling pattern,`fetchMarketSnapshot` 直接 `fetch()` 不經 `__apiGet`;§3 file table / §6.7 / §11 step 7 全部 update
- **v2** (2026-06-29):`design-review-round-1.json` 7 條 finding 全 accepted 後 amend:
  - **F1** §6.2 useMarketSnapshot refresh() 改 `forceRefreshRef` pattern,對齊 `useOptionsLargeTraders.ts` 樣板 + CLAUDE.md §4 refresh 鐵則
  - **F2** §6.1 移除不存在的 `useLocalStorageState`,改用 `useState + useEffect` inline pattern,對齊 App.tsx:67-71 慣例
  - **F3** §4 payload size 用真實 byte (115B/stock) 重估;cap 30/sector;加 Phase 3 measurement gate
  - **F4** §6.2 hook 加 `enabled` prop;§6.1 App.tsx 傳 `isActive={mode === "market"}`;mode 切走自動暫停 polling
  - **F5** §5.5 / §10 LeaderboardRow 加 `volume_ratio: number | null`,量比 tab 顯示數值
  - **F6** §5.3 sector dedup 改 deterministic:`_PRIMARY_INDUSTRY_OVERRIDE` table(top 10 權值股)+ `(date desc, industry_category asc)` 字典序 tie-breaker
  - **F7** §3 file table 加 `ModeSwitch.test.tsx` 修改一列;§11 step 13 改 TDD 先紅再綠
