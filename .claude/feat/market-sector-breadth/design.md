# Design — market-monitor-v2 P3 sector breadth heatmap + sector volume ratio

**Version**: v2
**Date**: 2026-07-01
**Pre-reading**: `brainstorm.md`(本 dir) / `docs/specs/market-monitor-v2/spec.md §6.2, §6.5, §8` / `docs/specs/market-monitor-v2/plan.md Phase 3` / `backend/services/market_breadth.py`(P2 樣板) / `backend/services/finmind_realtime.py`(整合點)

## Changelog

- **v2**(2026-07-01)— Phase 1 review round 1 accept 9 findings:F1 sort key None-safe / F2 hoist _extract into orchestrator / F3 empty prices → return [] / F4 partial-fetch inherited from P2 documented / F5 today_vol_lots int not float / F6 try/except drops ValueError / F7 global today_date documented / F8 <20 trading days cascade documented / F9 MA20 inclusive convention documented
- **v1**(2026-07-01)— initial design;採 P2 cache_key reuse 策略(KG3 mitigation)+ sector_map injection(不重推)

---

## 1. 架構總覽

新增 backend service `services/sector_aggregation.py`,兩個 public 入口:

```
compute_sector_breadth(end_date, universe, sector_map, lookback_days=60, refresh=False) -> list[SectorBreadthResult]
compute_sector_volume_ratio(end_date, universe, sector_map, lookback_days=60, avg_window=20, refresh=False) -> list[SectorVolResult]
```

內部拆兩段:
```
compute_sector_breadth
  ├─ (fetch)  _fetch_prices_window(start, end, refresh)   ← delegate to market_breadth._fetch_daily_prices_window
  │            (SAME cache_key → 共用 P2 24h cache;KG3 mitigation)
  └─ (pure)   _aggregate_sector_breadth(prices, sector_map, universe)
       ├─ per stock: build close-by-date map → determine today_date (max date)
       ├─ per stock: compute ma20 = mean(last 20 trading day closes ≤ today_date)
       ├─ per sector: partition members by sector_map; count(close_today > ma20) / total_valid_members
       └─ output sorted by pct desc

compute_sector_volume_ratio
  ├─ (fetch)  _fetch_prices_window(start, end, refresh)   ← same reuse
  └─ (pure)   _aggregate_sector_volume_ratio(prices, sector_map, universe, avg_window)
       ├─ per sector: sum today_vol_lots + sum daily_sector_vol per past 20 trading days
       ├─ vol_ratio = today_vol_lots / mean(past 20 days sector_vol_sum)
       └─ flag = 'hot' if > 1.5, 'cold' if < 0.7, else None
```

**設計原則**:
- 純 aggregation 函式獨立單測(SC-1/2/3 全走 fixture,不打 FinMind)
- Orchestrator(SC-4/5)走「注入 fetcher stub」測 flow
- SC-6 整合走 `finmind_realtime._do_fetch_market_snapshot` 追加兩個 `_fetch_sector_breadth` / `_fetch_sector_volume_ratio` helper 呼叫,**兩個獨立 try/except**(互不影響),失敗 → None,**不動 stale**(F6 sequel 對齊 P2)
- Cache 共用 P2 `breadth_prices_<start>_<end>` — 冷啟動 ~257s 只跑一次(mitigation KG3)

## 2. 檔案組織

| 檔案 | 責任 | 動作 |
|---|---|---|
| `backend/services/sector_aggregation.py` | 兩 orchestrator + 純 aggregation 函式 + `_fetch_prices_window` 薄殼(delegate P2)+ `SectorBreadthResult` / `SectorVolResult` TypedDict | 🟢 新 |
| `backend/tests/test_sector_aggregation.py` | ≥ 10 unit test 覆蓋 SC-1~5 + edge cases | 🟢 新 |
| `backend/services/finmind_realtime.py` | 追加 `_fetch_sector_breadth` + `_fetch_sector_volume_ratio` + payload 加兩欄位;**不動 stale 契約**(F6 sequel) | 🔵 改(小) |
| `backend/tests/test_finmind_realtime.py` | 加 1 integration test 驗 SC-6(payload 有兩欄位 + stale 不因兩者 fail 而 flip) | 🔵 改(加 test) |

**不動**:
- `services/market_universe.py`(P1,injection via caller)
- `services/market_breadth.py`(P2,只 import `_fetch_daily_prices_window` + `_SLOW_EMA_PERIOD` + `_DEFAULT_LOOKBACK_DAYS` 常數 — reuse not modify)
- `services/finmind_realtime.py::_dedup_sector_map` / `_PRIMARY_INDUSTRY_OVERRIDE`(P3 靠 finmind_realtime 傳入 sector_map,不重推)
- Frontend(spec.md Phase 5)
- `_CACHE_VERSION_REALTIME`(spec §4 明示 P3 不 bump);`_CACHE_VERSION_BREADTH` 也不動(共用 P2 cache 版本)
- P2 breadth 欄位 + P1 universe_size/excluded_count payload 順序不動

## 3. 資料流

```
┌──────────────────────────────────────────────────────────────┐
│ routes/market.py::get_snapshot  →  fetch_market_snapshot()   │
└───────────────────────────────┬──────────────────────────────┘
                                │ (existing) reuses:
                                ├─ _fetch_universe / _fetch_sector_map / _fetch_market_value_map / _fetch_watch_list
                                │ (produces `allowed` set + `primary_sector` dict)
                                │
                                ├─→ (existing P2) _fetch_breadth(end, allowed) → snapshot["breadth"]
                                │
                                ├─→ NEW: _fetch_sector_breadth(end, allowed, primary_sector)
                                │        │
                                │        └─ sector_aggregation.compute_sector_breadth(...)
                                │           └─ _fetch_prices_window(start, end)  ← REUSE P2 cache_key
                                │
                                └─→ NEW: _fetch_sector_volume_ratio(end, allowed, primary_sector)
                                         │
                                         └─ sector_aggregation.compute_sector_volume_ratio(...)
                                            └─ _fetch_prices_window(start, end)  ← REUSE P2 cache_key (same call)

payload extension (add-only):
{
  ... existing (P1/P2) ...,
  "sector_breadth":       [ {sector, members, above_ma20, pct}, ... ] | null,
  "sector_volume_ratio":  [ {sector, today_vol_lots, vol_ratio, flag}, ... ] | null,
}
```

**Cache reuse 關鍵**:三個 compute(P2 breadth + P3 sector_breadth + P3 sector_volume_ratio)呼叫**同一** `_fetch_daily_prices_window(start, end, refresh)`,且 `start` / `end` 完全相同 → 同一個 `breadth_prices_<start>_<end>` cache key → 冷啟動只跑一次,後兩者透過 `_run_once` inflight dedup(P2 內建)拿到 in-flight result;熱啟動走 24h cache。

## 4. 邊界 / 接點

### 4.1 Public API — orchestrators

```python
class SectorBreadthResult(TypedDict):
    sector: str
    members: int          # effective members(有 ma20 + close_today 的股)
    above_ma20: int
    pct: float            # above_ma20 / members;members=0 時該 sector 不出現


class SectorVolResult(TypedDict):
    sector: str
    today_vol_lots: int       # (F5) int not float — spec §8 契約;sum(volume) // 1000
    vol_ratio: float | None    # 20-day mean 為 0 or 資料不足 → None
    flag: str | None           # "hot"(>1.5) / "cold"(<0.7) / None


async def compute_sector_breadth(
    end_date: date,
    universe: set[str],
    sector_map: dict[str, str],   # from finmind_realtime._dedup_sector_map
    lookback_days: int = 60,       # **matches P2 default** to share cache_key
    refresh: bool = False,
) -> list[SectorBreadthResult]:
    """Aggregate per-sector breadth (% close > MA20).
    Sorted by pct DESC, tie-break sector name ASC.
    Sectors with 0 effective members omitted.
    Empty prices (F3) → return [].
    """


async def compute_sector_volume_ratio(
    end_date: date,
    universe: set[str],
    sector_map: dict[str, str],
    lookback_days: int = 60,
    avg_window: int = 20,
    refresh: bool = False,
) -> list[SectorVolResult]:
    """Aggregate per-sector today volume ratio vs 20-day average.
    Sort key (F1 None-safe): (vol_ratio is None, -vol_ratio_or_0, sector_asc)
      → 非 None DESC first, None 排最後, tie-break sector name ASC.
    Sectors with 0 today_vol_lots omitted.
    Empty prices (F3) → return [].
    """
```

**行為**:
- `universe` 為空 → `raise ValueError("universe_empty")`(對齊 P2 SC-5)
- `sector_map` 為空 → 所有股歸「其他」(orchestrator 內 fallback);若 universe 也空則走上面 raise
- Fetcher fail(httpx.HTTPError)→ **propagate**(P2 same;上層 `_do_fetch_market_snapshot` 用 try/except graceful handle)
- `refresh=True` 一路傳到 fetcher(共用 P2 cache 亦一同 refresh)

### 4.2 純 aggregation 函式(F2 fix — orchestrator hoist _extract)

```python
def _extract_close_and_volume_by_stock(
    prices: list[dict],
    universe: set[str],
) -> dict[str, dict[date, tuple[float, int]]]:
    """從 daily price rows 建 stock_id → { date → (close, volume_shares) }。

    對齊 P2 `_count_daily_ups_downs` F6:同 (sid, date) duplicate → keep last value。
    (F5) Volume unit = shares (int);orchestrator/aggregator 再除 1000 轉 lots。

    Rules:
    - stock_id not in universe → skip
    - close / date 缺 or non-numeric → skip that row
    - Volume 欄位缺(FinMind 罕見)or non-numeric:volume = 0(不 skip row,仍保留 close)
    - date 用 ISO string → date object(row['date']:'YYYY-MM-DD')
    - Same (sid, date) 重複 row → 用 later value 覆蓋(F6-echo)
    """


def _compute_ma20(closes_sorted_asc: list[float], window: int = 20) -> float | None:
    """< window → None;≥ window → 最後 window 個算術平均(F9: **inclusive** —
    includes today's close;標準 TA 慣例對齊 StockCharts / TradingView)。"""


def _aggregate_sector_breadth(
    by_stock: dict[str, dict[date, tuple[float, int]]],   # (F2) 前段 hoist 產出
    sector_map: dict[str, str],
    today_date: date | None = None,     # None → 取 max date across by_stock all dates
) -> list[SectorBreadthResult]:
    """Per-sector: count(close_today > ma20) / count(effective members)。

    Rules:
    - (F3) by_stock 空 or 無 valid dates → return []
    - today_date default = max(all dates across all stocks in by_stock);
      (F7) 這是 **global** choice — 個股該日無 close → drops from effective_members
      (accepted trade-off vs per-stock last-known,對齊「as of a specific trading day」語意)
    - Effective member: 有 ma20(需 ≥ 20 trading day 歷史,不足 → None → skip)且
      today_date 該股有 close
    - Sector not in sector_map → 歸 "其他"(fallback,對齊 finmind_realtime._group_by_sector)
    - Sector effective_members = 0 → 該 sector 不出現在 result
    - (F8) 若 window 內 < 20 trading day 資料 → 所有股 ma20=None → 所有 sector effective_members=0
      → return []
    - 排序 pct DESC(tie-break sector name ASC)
    """


def _aggregate_sector_volume_ratio(
    by_stock: dict[str, dict[date, tuple[float, int]]],   # (F2) 前段 hoist 產出
    sector_map: dict[str, str],
    avg_window: int = 20,
    today_date: date | None = None,
) -> list[SectorVolResult]:
    """Per-sector: today_vol_lots / mean(past N trading days sector daily_vol_sum)。

    Rules:
    - (F3) by_stock 空 or 無 valid dates → return []
    - today_date default = max(all dates across all stocks in by_stock);global choice 同 F7
    - Sector not in sector_map → 歸 "其他"
    - today_vol_shares = sum(volume on today_date for members in sector);
      (F5) today_vol_lots = today_vol_shares // 1000  (int,對齊 spec §8 契約)
    - Past N days sector daily_vol_sum = list of (Σvolume_shares per day for members
      in sector) **excluding** today_date
    - vol_ratio = today_vol_shares / mean(past N days daily_vol_sum);
      (F8) 若 past days 有效資料 < avg_window,或均值 = 0 → vol_ratio = None
    - Sector today_vol_lots = 0 → 該 sector 不出現(spec §6.5 semantic:今日整族群無量 = 缺席)
    - flag: > 1.5 "hot" / < 0.7 "cold" / else None(vol_ratio=None → flag=None)
    - (F1) 排序 key = (vol_ratio is None, -(vol_ratio or 0.0), sector_asc)
      → non-None DESC first, None 排最後, tie sector name ASC
    """
```

### 4.3 Fetcher — delegate to P2

```python
async def _fetch_prices_window(
    start: date,
    end: date,
    refresh: bool = False,
) -> list[dict]:
    """Thin delegate → market_breadth._fetch_daily_prices_window.

    共用 cache_key `breadth_prices_<start>_<end>` → 三個 compute(P2 breadth +
    P3 sector_breadth + P3 sector_volume_ratio)冷啟動只跑一次 fetch。
    Tests patch **sector_aggregation._fetch_prices_window** 本模組符號 —
    不 patch P2 內部(避免測試耦合)。
    """
    from services import market_breadth as mb  # 延 import 避 circular
    return await mb._fetch_daily_prices_window(start, end, refresh=refresh)
```

**window derivation**:與 P2 一致 — `pad_days = int((lookback_days + _SLOW_EMA_PERIOD) * 2.0)`;`_SLOW_EMA_PERIOD` 從 `market_breadth` import(single source of truth,避免 drift)。這是刻意的耦合,理由是 shared cache_key。

**為何不直接 `_do_fetch_prices` 一路穿過去**:P2 `_fetch_daily_prices_window` 已封裝(cache check + inflight dedup + _do_fetch_prices),P3 直接呼叫它拿完全一樣的行為 + cache 命中率。

### 4.4 整合 — `services/finmind_realtime.py`(F6 sequel — 不動 stale)

新增 module-local helper(對齊 P2 `_fetch_breadth` pattern):

```python
async def _fetch_sector_breadth(
    end_date: date,
    universe: set[str],
    sector_map: dict[str, str],
    refresh: bool = False,
) -> list[dict] | None:
    """Delegate to sector_aggregation.compute_sector_breadth。
    empty universe → None(silent skip)。"""
    if not universe:
        return None
    from services import sector_aggregation as sa
    return await sa.compute_sector_breadth(end_date, universe, sector_map, refresh=refresh)


async def _fetch_sector_volume_ratio(
    end_date: date,
    universe: set[str],
    sector_map: dict[str, str],
    refresh: bool = False,
) -> list[dict] | None:
    """同上,delegate to compute_sector_volume_ratio。"""
    if not universe:
        return None
    from services import sector_aggregation as sa
    return await sa.compute_sector_volume_ratio(end_date, universe, sector_map, refresh=refresh)
```

在 `_do_fetch_market_snapshot` 內,`allowed` 產出後、既有 breadth try/except **之後**追加兩個 **獨立** try/except。**(F6) 只 catch httpx.HTTPError**:F3 fix 已把 max-on-empty 換成 `return []`,`universe_empty` ValueError 被 `_fetch_*` gate 攔下,實際會傳到這裡的只剩 fetcher 端 httpx 異常:

```python
# 既有 P2 breadth try/except(不動;P2 保留 ValueError catch,因 P2 SC-5 universe_empty 走 compute_breadth raise 路徑)
try:
    breadth = await _fetch_breadth(clock.today(), allowed, refresh=refresh)
except (httpx.HTTPError, ValueError) as exc:
    logger.warning("market snapshot: breadth compute failed: %s", exc)
    breadth = None

# P3 SC-6 — sector_breadth(獨立 try/except,不與 vol_ratio 耦合;F6: 只 httpx)
try:
    sector_breadth = await _fetch_sector_breadth(
        clock.today(), allowed, primary_sector, refresh=refresh
    )
except httpx.HTTPError as exc:
    logger.warning("market snapshot: sector_breadth compute failed: %s", exc)
    sector_breadth = None

# P3 SC-6 — sector_volume_ratio(獨立 try/except;F6: 只 httpx)
try:
    sector_volume_ratio = await _fetch_sector_volume_ratio(
        clock.today(), allowed, primary_sector, refresh=refresh
    )
except httpx.HTTPError as exc:
    logger.warning("market snapshot: sector_volume_ratio compute failed: %s", exc)
    sector_volume_ratio = None

# stale 契約不變(F6 sequel):
# stale = isinstance(universe_res, BaseException) or sector_degraded or watch_degraded
# sector_breadth / vol_ratio fail 都不動 stale(EOD data ≠ intraday degradation)

return {
    ... existing P1/P2 fields ...,
    "sector_breadth": sector_breadth,
    "sector_volume_ratio": sector_volume_ratio,
}
```

**為何分兩個 try/except 不 gather**:
- 語意:sector_breadth 跟 vol_ratio 邏輯獨立,一個 raise 不代表另一個一定 raise
- Test 覆蓋容易:mock 一個 raise 另一個 ok 檢查 partial 降級
- 序列化執行代價:兩 call 都共用 cache_key,第二呼叫拿 in-flight/cache hit,near-zero cost
- 若改 gather 並 return_exceptions=True 也可,但增加 code 複雜度,不划算

Payload shape:

```jsonc
{
  ... existing (P1/P2) ...,
  "sector_breadth": [
    { "sector": "半導體業", "members": 142, "above_ma20": 89, "pct": 0.627 },
    { "sector": "電子零組件業", "members": 87, "above_ma20": 55, "pct": 0.632 },
    ...
  ] | null | [],   // [] when empty prices (F3);null when httpx failure
  "sector_volume_ratio": [
    { "sector": "食品工業", "today_vol_lots": 89000, "vol_ratio": 1.62, "flag": "hot" },
    { "sector": "電子零組件業", "today_vol_lots": 1234567, "vol_ratio": 1.42, "flag": null },
    ...
  ] | null | []
}
```

## 5. SC-N 對應設計章節

| SC | 對應章節 | 對應純函式 / API |
|---|---|---|
| SC-1 | §4.2 `_compute_ma20` | `_compute_ma20` |
| SC-2 | §4.2 `_aggregate_sector_breadth` + `_extract_close_and_volume_by_stock` | 兩者 |
| SC-3 | §4.2 `_aggregate_sector_volume_ratio` | 該函式 |
| SC-4 | §4.1 `compute_sector_breadth` + §4.3 `_fetch_prices_window` | orchestrator + fetcher shim |
| SC-5 | §4.1 `compute_sector_volume_ratio` + flag 邏輯 | orchestrator + `flag` classifier |
| SC-6 | §4.4 finmind_realtime 整合(獨立 try/except + payload) | `_fetch_sector_breadth` / `_fetch_sector_volume_ratio` |

## 6. Testability

- **純函式(SC-1/2/3)**:直接餵手算 fixture — 3 sectors × 3~5 stocks × 30 天,不打 FinMind
- **`_extract_close_and_volume_by_stock`**:fixture 含 duplicate row(F6-echo)+ 缺 Trading_Volume 欄 + 非 numeric close
- **`_aggregate_sector_breadth`**:fixture 含新上市 < 20 day 股 + sector 不在 sector_map(→ 「其他」)+ empty sector
- **`_aggregate_sector_volume_ratio`**:fixture 含 20-day avg = 0 sector + today 無 vol sector + hot/cold/normal 三種 flag pattern
- **Orchestrator(SC-4/5)**:`monkeypatch.setattr(sa, "_fetch_prices_window", async_stub)` 注入 fixture(**patch 本模組符號** 不 patch P2 `market_breadth._fetch_daily_prices_window`,避免測試耦合)
- **整合(SC-6)**:延用 P2 `test_finmind_realtime` 樣板;`monkeypatch` `_fetch_sector_breadth` / `_fetch_sector_volume_ratio` 為 stub,assert:
  1. Payload 兩新欄位存在
  2. sector_breadth raise → payload 該欄為 None,vol_ratio 仍算(獨立 try/except)
  3. Stale 不因兩者 fail 而 flip(F6 sequel)
  4. Empty universe → 兩欄位皆 None(silent skip)

## 7. 安全 / 輸入驗證 / 權限

- 無 user input(universe / sector_map / end_date 皆為 module 內部產出)
- 無 auth boundary
- FinMind token 走既有 `FinMindClient`,不新增外部依賴
- Cache path 走 `chip_cache_dir()`,無 path injection 面

## 8. 隱性假設

1. **FinMind `TaiwanStockPrice` per-day row 有 `Trading_Volume` 欄**:P2 evidence 顯示存在;若某日某股缺 → volume=0(不 skip row)
2. **(F5) Trading_Volume 單位是「股」**:P3 轉「張」用整除 `// 1000`(對齊台股慣例 + spec §8 payload int 契約);張 = 1000 股。**not float**
3. **(F7) `today_date` = max date across ALL prices**(global,非 per-stock):若 `end_date` 是週末,fetcher 回的 window 內最新交易日 = max_date < end_date,取 max 天然對齊「最近一個 valid trading day」語意。**個股該日無 close row(如當日停牌 / 全額交割 / FinMind sparse)→ drops from effective_members**(vs 用該股 last-known close 也 valid,但語意糊 "as of when"; 選 global 明確)
4. **20-day MA20 用 trading day 而非 calendar day**:對股價分析標準做法(對齊台股慣例 + P2 breadth EMA 用 trading day)。前 20 個 trading day 之前的 close 用來算 ma20;第 20 day 之後才有 valid ma20
5. **Sector map key = stock_id, value = industry_category string**:對齊 `finmind_realtime._dedup_sector_map` 回傳格式(dict[str, str],value 是「半導體業」中文)
6. **Sector 名「其他」對齊 finmind_realtime `_group_by_sector` fallback**:未在 sector_map 的股統一歸「其他」
7. **`pct` 精度**:用 Python native float(不特別四捨五入),API 消費者(前端)自處理顯示精度
8. **`vol_ratio` 精度**:同上,不四捨五入
9. **(F4) 共用 cache 繼承 P2 partial-fetch 語意**:P2 `_do_fetch_prices` per-trading-day loop 若部分日 fetch fail(httpx.HTTPError),已 log warning 但仍寫 partial rows 到 cache(24h TTL);P3 讀該 cache 時**看不出**哪幾天 partial → sector_breadth / sector_volume_ratio 於 partial 日計算結果偏誤,無 known_gaps 標示。**Accept as inherited KG3**;spec §9 已收錄。V2.5 P2 若加 partial-fetch metadata → P3 順帶 surface
10. **(F7 continuation) 若整 universe 都在 today_date 無 close row**(極端:全市場停市)→ effective_members = 0 for all sector → `sector_breadth = []`(空 list,不 raise);同理 vol_ratio 無 today → `sector_volume_ratio = []`
11. **(F9) MA20 inclusive convention**:`ma20 = mean(last 20 closes 包含 today's close)`,對齊 StockCharts / TradingView 標準;`close > ma20` 語意 = 今日 close 高於自身過去 20 天(含今日)均值,mathematically 等價於 close > mean(prior 19 days) — 標準 TA 慣例
12. **(F2) `_extract_close_and_volume_by_stock` 兩 orchestrator 各呼叫一次**:總 2×O(N) 每 snapshot request;accepted trade-off 換取 aggregation fn testability(可獨立餵 by_stock fixture 不打 FinMind);比 3×O(N)(P2 breadth + 2× P3)只多 1×;實測 ~150k row Python dict build ≈ 2-3s,total penalty ≤ 6s post-cache-warm

## 9. Known Risks

- **R1(繼承 P2)**:全市場 date-range payload 冷啟動 ~257s;P3 靠 cache_key reuse mitigate(second/third caller 拿 in-flight result),但**首次冷啟動代價無法消除**,標 known gap **KG3**(繼承)
- **R2**:「其他」sector 可能因 sector_map 未覆蓋(新上市 / TPEx 冷門股)而聚集大量成員 → dominate heatmap 顏色;real-env verification 檢查該 sector members 數,若異常大標 known gap **KG6**(spec §9)
- **R3**:volume ratio 閾值 1.5 / 0.7 hardcode 美股慣例,台股未校準 → 標 known gap **KG5**,V2.5 backtest 校準或抽參數
- **R4**:sector 名硬編中文「其他」— 若未來 P4/P5 前端要 i18n 會撞;本 P3 不處理,標 next-time.md
- **R5**:Window derivation coupling P2 `_SLOW_EMA_PERIOD` 常數 — 若 P2 改該常數 P3 靜默受影響(cache_key drift → cold fetch);Phase 3 加註釋 + 單元測驗證兩處常數同值;V2.5 考慮抽 shared module

## 10. 反身性 self-audit

1. **「共用 cache」是 KG3 mitigation 還是 tech debt?** — 共用是實用主義,兩檔 `_SLOW_EMA_PERIOD` 一致靠 Python import(不 hardcode 39)。若未來 P4 sector_amount_share 也共用同一 cache_key,設計會很優雅;若 P4 需不同 window 則要重評
2. **獨立 try/except 而非 gather** — 語意獨立性 > 微小性能 cost。Gather 版本 code 更簡但語意糊,選前者
3. **`_extract_close_and_volume_by_stock` 為何 tuple 而非兩個 dict?** — 兩 aggregation 都要 (close, volume),tuple 一次遍歷 O(N) 建構;分開兩 dict 要遍歷兩次
4. **`today_date` = max date 是否會踩到「昨日 vs 今日」語意混淆?** — Fetcher 回的 window 已收斂到 [start, end] 交易日 union;max date = 該 window 內最新交易日,語意即「最近一個 valid trading day」,無混淆
5. **P3 綁死 P2 `_SLOW_EMA_PERIOD` 是否耦合太緊?** — R5 已標;取捨是 KG3 mitigation vs 微耦合。選 mitigation,配單元測 lock 常數同值
6. **Test coverage 是否 dry-run 過?** — SC-2 test 需含新上市股(< 20 day) + 「其他」sector fallback + empty sector,SC-3 test 需含 20-day avg = 0 + hot/cold/normal 三種 flag,SC-6 test 需含 partial fail + stale 不動。全在 Phase 2 test 清單
