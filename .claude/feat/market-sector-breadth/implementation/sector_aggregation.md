# Implementation Spec — `backend/services/sector_aggregation.py`

**Pre-reading**: `../design.md` v2 §4.1~§4.3

## 1. File header

```python
"""Phase 3 — sector aggregation service (breadth + volume ratio).

Spec: docs/specs/market-monitor-v2/spec.md §6.2 / §6.5.
Design: .claude/feat/market-sector-breadth/design.md v2

Two public entry points:
- compute_sector_breadth: % close > MA20 per sector
- compute_sector_volume_ratio: today vol / mean 20-day sector vol

Both delegate to services.market_breadth._fetch_daily_prices_window
for a SHARED cache_key (`breadth_prices_<start>_<end>`) → cold fetch runs
once for all three consumers (P2 breadth + P3 breadth + P3 vol_ratio).
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from typing import TypedDict

logger = logging.getLogger(__name__)

_DEFAULT_LOOKBACK_DAYS = 60           # matches market_breadth._DEFAULT_LOOKBACK_DAYS
_MA_WINDOW = 20                       # SC-1 MA20
_VOL_AVG_WINDOW = 20                  # SC-3 default avg_window
_VOL_HOT_THRESHOLD = 1.5
_VOL_COLD_THRESHOLD = 0.7
_OTHER_SECTOR = "其他"
```

## 2. TypedDict declarations

```python
class SectorBreadthResult(TypedDict):
    sector: str
    members: int
    above_ma20: int
    pct: float


class SectorVolResult(TypedDict):
    sector: str
    today_vol_lots: int
    vol_ratio: float | None
    flag: str | None
```

## 3. Functions

### 3.1 `_extract_close_and_volume_by_stock(prices, universe)` — pure

- Signature: `(list[dict], set[str]) -> dict[str, dict[date, tuple[float, int]]]`
- Return: `{stock_id: {date: (close_float, volume_shares_int)}}`
- Behavior:
  - Iterate prices; parse `stock_id`, `date` (ISO), `close`, `Trading_Volume`
  - If `stock_id not in universe` → skip
  - If `close` / `date` missing or non-numeric → skip row
  - `volume = int(Trading_Volume) if numeric else 0` (F5 unit = shares)
  - Same `(sid, date)` duplicate → later value wins (F6-echo)
- Failure tests (Phase 3 red):
  - **T1**: hand-built rows for 3 stocks × 5 dates → correct nested dict
  - **T2**: stock_id not in universe → dropped
  - **T3**: row with missing close → skipped (that (sid,date) not present)
  - **T4**: duplicate (sid, date) row → later value overrides
  - **T5**: row with missing Trading_Volume → volume=0 kept, close still recorded

### 3.2 `_compute_ma20(closes_sorted_asc, window=20)` — pure

- Signature: `(list[float], int) -> float | None`
- Behavior:
  - `len < window` → `None`
  - Otherwise `sum(closes[-window:]) / window`
- Failure tests (Phase 3 red):
  - **T6**: 20 closes = [1..20] → mean = 10.5
  - **T7**: 19 closes → None
  - **T8**: 25 closes = [1..25] → mean(last 20) = 15.5
  - **T9**: window=5, 5 closes = [10,20,30,40,50] → 30.0

### 3.3 `_aggregate_sector_breadth(by_stock, sector_map, today_date=None)` — pure

- Signature: `(dict[str, dict[date, tuple[float, int]]], dict[str, str], date | None) -> list[SectorBreadthResult]`
- Behavior:
  - **F3**: `by_stock` 空 → `return []`
  - **today_date default**: `max(all dates across all stocks)` — if no dates exist → `return []`
  - For each `stock_id`:
    - `dates_asc = sorted(by_stock[stock_id].keys())`
    - `closes_up_to_today = [close for d, (close, _) in ordered pairs if d <= today_date]` (inclusive per F9)
    - `ma20 = _compute_ma20(closes_up_to_today)` — None if < 20 days
    - If `ma20 is None` → stock skipped (not counted in denominator)
    - `today_close = by_stock[stock_id].get(today_date, (None,None))[0]` — if None → stock skipped
    - `is_above = today_close > ma20`
    - `sector = sector_map.get(stock_id, "其他")` (F7 fallback)
  - Group by sector; compute `members = count`, `above_ma20 = sum(is_above)`, `pct = above_ma20 / members`
  - Omit sectors with `members == 0`
  - Sort: `key=lambda r: (-r['pct'], r['sector'])` — pct DESC, sector ASC
- Failure tests (Phase 3 red):
  - **T10**: 3 sectors × 3 stocks × 25 dates, all above MA20 → pct=1.0 for all
  - **T11**: sector A stocks: 2/3 above → pct ≈ 0.667
  - **T12**: 1 stock in sector A has only 15 days → skipped from denominator (2 members)
  - **T13**: stock in sector B lacks today_close row (halt) → skipped
  - **T14**: stock_id not in sector_map → 歸 "其他" sector
  - **T15**: by_stock 空 → `[]`
  - **T16**: sector with 0 effective members (all < 20 days) → omitted from result
  - **T17**: window has only 15 trading days total (< MA_WINDOW) → all stocks ma20=None → return []
  - **T18**: sort stability — tie pct with two sectors → sorted by sector name ASC

### 3.4 `_aggregate_sector_volume_ratio(by_stock, sector_map, avg_window=20, today_date=None)` — pure

- Signature: `(dict[str, dict[date, tuple[float, int]]], dict[str, str], int, date | None) -> list[SectorVolResult]`
- Behavior:
  - **F3**: `by_stock` 空 → `return []`
  - `today_date default`: `max(all dates across all stocks)` — if no dates → `return []`
  - Build per-sector per-day volume sum:
    - `sector_day_vol: dict[str, dict[date, int]] = {}`
    - For each `stock_id`: `sector = sector_map.get(stock_id, "其他")`
      - For `d, (close, vol) in by_stock[stock_id]`: `sector_day_vol[sector][d] += vol`
  - For each sector:
    - `today_vol_shares = sector_day_vol[sector].get(today_date, 0)`
    - If `today_vol_shares == 0` → sector omitted
    - `today_vol_lots = today_vol_shares // 1000`
    - Past 20 天 sector daily_vol_sum(F5 review revision — 移除 stray draft line):
      - `past_days_sorted = sorted(sector_day_vol[sector].items(), key=lambda x: x[0], reverse=True)`
      - `past_vols = [v for d, v in past_days_sorted if d < today_date][:avg_window]`
    - If `len(past_vols) < avg_window` or `mean(past_vols) == 0` → `vol_ratio = None, flag = None`
    - Else `vol_ratio = today_vol_shares / mean(past_vols)`
    - `flag = "hot" if vol_ratio > 1.5 else "cold" if vol_ratio < 0.7 else None` (None when vol_ratio None)
  - Sort: **F1** `key=lambda r: (r['vol_ratio'] is None, -(r['vol_ratio'] or 0.0), r['sector'])`
- Failure tests (Phase 3 red):
  - **T19**: 2 sectors × 2 stocks × 25 days, today vol = 2× past avg → vol_ratio ≈ 2.0, flag="hot"
  - **T20**: past 20-day mean = 0 for a sector → vol_ratio=None, flag=None
  - **T21**: today no vol for sector B → sector B omitted
  - **T22 (F1 review revision)**: **four sectors**: hot(2.0) / normal(1.0) / cold(0.5) / **vol_ratio=None**(mean=0)→ sorted `[hot, normal, cold, None-sector]` under key `(vol_ratio is None, -(vol_ratio or 0.0), sector)`;None-tier branch 顯性 exercised
  - **T23**: vol_ratio just below 0.7 → flag="cold"
  - **T24**: by_stock 空 → `[]`
  - **T25**: past < 20 days available → vol_ratio=None
  - **T26**: today_vol_shares // 1000 → int (spec §8 契約)
  - **T27**: sort stability — two sectors same vol_ratio → tie-break sector name ASC
  - **T28-vol-E3 (F2 review revision — brainstorm E3 vol-asymmetry)**: sector A 有 1 個新上市股(僅 5 天 rows,含 today)+ 2 established 股(25 天);assert sector A today_vol_shares 包含新股 today vol(不 skip)、vol_ratio 用「20 天 sector daily_vol sum」(established members 主導 past 20 天)
  - **T29-vol-E6 (F3 review revision)**: 1 個 stock 不在 sector_map → assert result 含「其他」sector,today_vol_lots 包含該股,參與排序

### 3.5 `_fetch_prices_window(start, end, refresh=False)` — thin delegate

```python
async def _fetch_prices_window(
    start: date,
    end: date,
    refresh: bool = False,
) -> list[dict]:
    """Delegate to services.market_breadth._fetch_daily_prices_window.

    共用 cache_key `breadth_prices_<start>_<end>` (F4 note: inherit partial-
    fetch semantic silently — see design.md §8 assumption 9).
    Tests patch this module's _fetch_prices_window symbol, not market_breadth.
    """
    from services import market_breadth as mb
    return await mb._fetch_daily_prices_window(start, end, refresh=refresh)
```

- Failure tests: covered by orchestrator tests (T28, T29 below)

### 3.6 `compute_sector_breadth(end_date, universe, sector_map, lookback_days=60, refresh=False)` — orchestrator

```python
async def compute_sector_breadth(
    end_date: date,
    universe: set[str],
    sector_map: dict[str, str],
    lookback_days: int = _DEFAULT_LOOKBACK_DAYS,
    refresh: bool = False,
) -> list[SectorBreadthResult]:
    if not universe:
        raise ValueError("universe_empty")
    # Match P2 window derivation for shared cache_key
    from services import market_breadth as mb
    pad_days = int((lookback_days + mb._SLOW_EMA_PERIOD) * 2.0)
    start = end_date - timedelta(days=pad_days)
    prices = await _fetch_prices_window(start, end_date, refresh=refresh)
    by_stock = _extract_close_and_volume_by_stock(prices, universe)
    return _aggregate_sector_breadth(by_stock, sector_map)
```

- Failure tests (Phase 3 red):
  - **T30**: monkeypatch `_fetch_prices_window` → returns fixture prices → asserts SectorBreadthResult list shape + sorted
  - **T31**: universe=set() → `raises ValueError("universe_empty")`
  - **T-E9-breadth (F4 review revision — brainstorm E9)**: by_stock max date = 2026-06-26 (Fri);orchestrator called with `end_date=2026-06-28` (Sun) → assert compute_sector_breadth 用 2026-06-26 為 today_date + 回非空 result

### 3.7 `compute_sector_volume_ratio(end_date, universe, sector_map, lookback_days=60, avg_window=20, refresh=False)` — orchestrator

```python
async def compute_sector_volume_ratio(
    end_date: date,
    universe: set[str],
    sector_map: dict[str, str],
    lookback_days: int = _DEFAULT_LOOKBACK_DAYS,
    avg_window: int = _VOL_AVG_WINDOW,
    refresh: bool = False,
) -> list[SectorVolResult]:
    if not universe:
        raise ValueError("universe_empty")
    from services import market_breadth as mb
    pad_days = int((lookback_days + mb._SLOW_EMA_PERIOD) * 2.0)
    start = end_date - timedelta(days=pad_days)
    prices = await _fetch_prices_window(start, end_date, refresh=refresh)
    by_stock = _extract_close_and_volume_by_stock(prices, universe)
    return _aggregate_sector_volume_ratio(by_stock, sector_map, avg_window=avg_window)
```

- Failure tests (Phase 3 red):
  - **T32**: monkeypatch `_fetch_prices_window` → returns fixture prices → asserts SectorVolResult list shape + sorted with None last
  - **T33**: universe=set() → `raises ValueError("universe_empty")`
  - **T34**: hot/cold/normal 三 flag classification integration test
  - **T-E9-vol (F4 review revision)**: 同 T-E9-breadth,orchestrator 落在 Sunday end_date → 用 Fri max_date 作 today

### 3.8 Lock test — P2 constants share

- **T35 (F6 review revision)**: **file placement = `backend/tests/test_sector_aggregation.py`**,在 `TestConstantsLock` class 內,`import services.market_breadth as mb` + assert `mb._SLOW_EMA_PERIOD == 39` and `mb._DEFAULT_LOOKBACK_DAYS == 60`(R5 drift lock;跑 P3 CI gate 一起執行)

## 4. SC-N ↔ test coverage matrix

| SC | tests |
|---|---|
| SC-1 (compute_ma20) | T6, T7, T8, T9 |
| SC-2 (aggregate_sector_breadth) | T1-T5 (extract), T10-T18 (aggregate) |
| SC-3 (aggregate_sector_volume_ratio) | T19-T27, T28-vol-E3, T29-vol-E6 |
| SC-4 (compute_sector_breadth orchestrator) | T30, T31, T-E9-breadth |
| SC-5 (compute_sector_volume_ratio orchestrator) | T32, T33, T34, T-E9-vol |
| Constants lock (R5) | T35 |
| SC-6 (finmind_realtime integration) | see `finmind_realtime_integration.md` |

Total: ~37 unit tests(+ 4 integration in another file)

## 5. Known Risks

- **R1**: `mb._SLOW_EMA_PERIOD` import couples P3 to P2 internal constants — T33 lock test catches drift
- **R2**: F2 hoist means `_extract` runs 2× per snapshot request (once per orchestrator). Accepted per design §8 assumption 12
