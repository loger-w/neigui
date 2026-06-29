# Implementation: Backend Services

Covers: `services/trading_session.py` + `services/finmind_realtime.py` + 2 tests.

Design source:`../design.md` v3 §5 (backend 細節)、§10 (interface)、§11 step 1-2。

---

## File 1:`backend/services/trading_session.py`(新增)

### Module header
```python
"""Pure trading-session helpers — no I/O.

Used by services/finmind_realtime.py to compute is_trading_session + lag.
Split out so the time-of-day / weekday logic is unit-testable without
touching FinMind, datetime mocking, or the universe cache.

design.md §5.4
"""
from __future__ import annotations

import logging
from datetime import datetime, time, timedelta, timezone

logger = logging.getLogger(__name__)

TPE_TZ = timezone(timedelta(hours=8))
SESSION_OPEN = time(9, 0)
SESSION_CLOSE = time(13, 30)
MAX_LAG_SECONDS_IN_SESSION = 60
```

### Function
```python
def is_in_session(
    now: datetime,
    last_tick: datetime | None,
) -> tuple[bool, int | None]:
    """Compute (in_session, lag_seconds).

    in_session = (TPE weekday Mon-Fri) AND
                 (TPE 09:00 ≤ now ≤ 13:30) AND
                 (last_tick exists AND lag ≤ MAX_LAG_SECONDS_IN_SESSION)

    lag_seconds = int((now - last_tick).total_seconds()) if last_tick else None
                  (可以為負,代表 last_tick 在 now 之後;呼叫端不該見此 case)

    `now` 必須 tz-aware。`last_tick` 為 naive 時(FinMind 的 `date` 欄位 ISO
    string parse 通常無 tz),內部視為 TPE 本地時間 — 透過顯式 normalisation
    避免 naive - aware → TypeError(v3 review B1 修)。
    """
    # v3 B1 fix — explicit tzinfo normalisation
    if last_tick is not None and last_tick.tzinfo is None:
        last_tick = last_tick.replace(tzinfo=TPE_TZ)
```

### Input/output examples
```python
>>> from datetime import datetime, timezone, timedelta
>>> tpe = timezone(timedelta(hours=8))
>>> now = datetime(2026, 6, 29, 10, 30, tzinfo=tpe)  # 週一 10:30 TPE
>>> last_tick = datetime(2026, 6, 29, 10, 29, 30, tzinfo=tpe)
>>> is_in_session(now, last_tick)
(True, 30)

>>> # 開盤前(v3 B2 修:19h20m = 69600s,原 70200 算錯)
>>> now = datetime(2026, 6, 29, 8, 50, tzinfo=tpe)
>>> is_in_session(now, datetime(2026, 6, 28, 13, 30, tzinfo=tpe))
(False, 69600)

>>> # 收盤後
>>> now = datetime(2026, 6, 29, 14, 0, tzinfo=tpe)
>>> is_in_session(now, datetime(2026, 6, 29, 13, 30, tzinfo=tpe))
(False, 1800)

>>> # 週日
>>> now = datetime(2026, 6, 28, 10, 30, tzinfo=tpe)  # Sun
>>> is_in_session(now, datetime(2026, 6, 26, 13, 30, tzinfo=tpe))
(False, 162000)

>>> # 沒 tick
>>> is_in_session(now, None)
(False, None)

>>> # tick 比 now 更新(時鐘倒退或測試 mock)→ lag 為負,session 仍判 False(lag > 60)
>>> now = datetime(2026, 6, 29, 10, 0, tzinfo=tpe)
>>> last_tick = datetime(2026, 6, 29, 10, 5, tzinfo=tpe)
>>> is_in_session(now, last_tick)
(False, -300)  # negative lag → not "in_session" 安全保守
```

---

## File 2:`backend/services/finmind_realtime.py`(新增)

### Module header
```python
"""Market snapshot fetch + aggregate + leaderboard.

Sibling to services/finmind.py — shares FinMindClient (HTTP / token /
rate limiter) via get_finmind() but isolates its own cache version + TTL
for the realtime universe / sector_map / market_value流。

Cache versions:
- _CACHE_VERSION_REALTIME = 1

TTLs:
- universe snapshot: 5 s (intraday live)
- sector_map: 24 h (TaiwanStockInfo 慢動)
- market_value: 24 h (EOD 上一交易日值)

design.md §5
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta
from pathlib import Path

import httpx

from services.finmind import get_finmind
from services.trading_session import is_in_session
from utils.cache import atomic_write_json, chip_cache_dir, read_json

logger = logging.getLogger(__name__)

_CACHE_VERSION_REALTIME = 1
_UNIVERSE_TTL_SECONDS = 5
_SECTOR_MAP_TTL_HOURS = 24
_MARKET_VALUE_TTL_HOURS = 24
_HEATMAP_STOCKS_CAP_PER_SECTOR = 30  # v3 F8
_LEADERBOARD_SIZE = 30

_PRIMARY_INDUSTRY_OVERRIDE: dict[str, str] = {
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
}
```

### Public function
```python
async def fetch_market_snapshot(refresh: bool = False) -> dict:
    """Return MarketSnapshot dict matching design.md §4 contract.

    Pipeline:
    1. asyncio.gather(_fetch_universe(refresh),
                      _fetch_sector_map(),
                      _fetch_market_value_map())
    2. _dedup_sector_map(rows) -> dict[stock_id, sector_name]
    3. _max_tick_date(universe) -> datetime | None
    4. is_in_session(now=datetime.now(tz=TPE_TZ), last_tick) -> (in_session, lag)
    5. _group_by_sector(...) -> sectors[]
    6. _compute_leaderboards(...) -> leaderboards{...}
    7. assemble payload

    On any FinMind upstream failure:
        - if disk cache 兜底:return {**cached_universe_payload, "stale": True}
        - else raise ValueError("finmind_unreachable") — caught by routes layer → 502

    Returns:
        {
          "as_of": ISO datetime string,
          "last_tick": ISO datetime string | None,
          "is_trading_session": bool,
          "stale": bool,
          "lag_seconds": int | None,
          "sectors": [...],
          "leaderboards": {...},
        }
    """
```

### Internal helpers — signatures only(Phase 3 TDD 才補實作)
```python
async def _fetch_universe(refresh: bool) -> list[dict]:
    """Call FinMind taiwan_stock_tick_snapshot (no data_id) via shared http
    client; cache 5 s to disk under utils.cache.chip_cache_dir() with key
    `realtime_universe.json`; honor refresh=True bypass."""

async def _fetch_sector_map() -> list[dict]:
    """Call FinMind /data?dataset=TaiwanStockInfo; cache 24 h to disk
    under key `realtime_sector_map.json`. Daily-static — not affected by
    refresh param."""

async def _fetch_market_value_map(today: date | None = None) -> dict[str, int]:
    """Call FinMind /data?dataset=TaiwanStockMarketValue with start_date=
    end_date= T-1 trading day; cache 24 h to disk under key
    `realtime_market_value.json`. Returns dict[stock_id, market_value]."""

def _dedup_sector_map(rows: list[dict]) -> dict[str, str]:
    """v3 §5.3 deterministic algorithm."""

def _max_tick_date(universe: list[dict]) -> datetime | None:
    """Parse universe[].date (ISO string with microseconds) → max; None if empty."""

def _group_by_sector(
    universe: list[dict],
    primary_sector: dict[str, str],
    mv_map: dict[str, int],
    cap_per_sector: int = _HEATMAP_STOCKS_CAP_PER_SECTOR,
) -> list[dict]:
    """Build sectors[] for heatmap. Within each sector, sort by market_value
    desc, take top `cap_per_sector`. Stocks without market_value → use
    sector median (E2 fallback)."""

def _compute_leaderboards(
    universe: list[dict],
    primary_sector: dict[str, str],
    size: int = _LEADERBOARD_SIZE,
) -> dict[str, list[dict]]:
    """Return {gainers, losers, amount, volume_ratio} 各 top size。每筆 row
    via _trim(): {stock_id, name, change_rate, total_amount, volume_ratio, sector}。"""

def _trim(rows: list[dict]) -> list[dict]:
    """v3 F5 — 含 volume_ratio。"""
```

### Cache layer integration
- Reuse `utils.cache.atomic_write_json` / `read_json` / `chip_cache_dir`(對齊既有 services/finmind.py:100-102)
- `_read_cache_v` / `_write_cache_v` 版本檢查走 `_CACHE_VERSION_REALTIME = 1`
- Concurrency dedup:每個 fetch 內走 `asyncio.Lock` 或者重用 `get_finmind()._run_once(key, fn)`(已在 FinMindClient 內部)
  - Phase 3 決定:先 keep 自己一個 `_inflight: dict[str, asyncio.Task]` 在 module-level,模仿 finmind.py:69

---

## File 3:`backend/tests/test_trading_session.py`(新增)

### Test signatures
```python
"""SC-5 — Trading session helper. Pure-function tests, no IO."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from services.trading_session import TPE_TZ, is_in_session


def test_in_session_weekday_mid_morning() -> None:
    """SC-5: 週一 10:30 + 30s lag → (True, 30)。"""
    ...

def test_pre_open_returns_false() -> None:
    """SC-5: 週一 08:50 → (False, lag_to_prev_close)。"""
    ...

def test_after_close_returns_false() -> None:
    """SC-5: 週一 14:00 + last_tick 13:30 → (False, 1800)。"""
    ...

def test_weekend_returns_false() -> None:
    """E6: 週日 → (False, lag)。"""
    ...

def test_no_last_tick_returns_false() -> None:
    """E6 / E7: last_tick=None → (False, None)。"""
    ...

def test_stale_lag_in_window_returns_false() -> None:
    """SC-5: 週一 10:30 但 last_tick 比 now 早 70 秒(超過 60s)→ in_session=False。"""
    ...

def test_negative_lag_safe() -> None:
    """Defensive: last_tick > now → lag 負 → in_session=False。"""
    ...

def test_session_open_boundary() -> None:
    """E5: 09:00:00 just open → in_session=True(lag 任意 ≤ 60)。"""
    ...

def test_session_close_boundary() -> None:
    """E5: 13:30:00 just close → in_session=True(若 lag ≤ 60),13:30:01 → False。"""
    ...

def test_naive_last_tick_treated_as_tpe() -> None:
    """v3 B1: FinMind ISO string parse 通常無 tz。傳 naive datetime 不應 TypeError,
    且 lag 計算正確(視同 TPE wall clock)。"""
    # now 是 aware,last_tick 是 naive
    now = datetime(2026, 6, 29, 10, 30, tzinfo=TPE_TZ)
    last_tick_naive = datetime(2026, 6, 29, 10, 29, 30)  # 無 tzinfo
    in_session, lag = is_in_session(now, last_tick_naive)
    assert in_session is True
    assert lag == 30

def test_pre_open_lag_value_locked() -> None:
    """v3 B2: 鎖住 doctest 範例 literal 值,避免 spec / impl 漂移。
    週一 08:50 vs 上週五 13:30 → lag = 19h20m = 69600。"""
    tpe = TPE_TZ
    now = datetime(2026, 6, 29, 8, 50, tzinfo=tpe)
    last_tick = datetime(2026, 6, 28, 13, 30, tzinfo=tpe)
    _, lag = is_in_session(now, last_tick)
    assert lag == 69600
```

**SC mapping**:11 個 test → SC-5(trading session detection)+ E6(weekend / no tick)+ E5(boundary)+ v3 B1 / B2 regression lock。

---

## File 4:`backend/tests/test_finmind_realtime.py`(新增)

### Test signatures(會用既有 conftest.py fixtures `_reset_finmind_singleton_and_env`)
```python
"""SC-1 — fetch_market_snapshot + helpers."""
from __future__ import annotations

import json
from datetime import date, datetime
from unittest.mock import AsyncMock, patch

import pytest

from services.finmind_realtime import (
    _PRIMARY_INDUSTRY_OVERRIDE,
    _compute_leaderboards,
    _dedup_sector_map,
    _group_by_sector,
    _max_tick_date,
    _trim,
    fetch_market_snapshot,
)


# --- _dedup_sector_map (E4 / F6 deterministic) ---

def test_dedup_single_row_basic() -> None:
    """SC-1: 單筆 row → {stock_id: sector_name}。"""
    ...

def test_dedup_multi_row_same_stock_uses_latest_date() -> None:
    """E4: 2854 兩 row,半導體業 date 2026-06-26 vs 電子工業 date 2026-06-25
    → 取半導體業(date desc)。Deterministic。"""
    ...

def test_dedup_multi_row_same_date_uses_industry_asc() -> None:
    """E4: 9999 兩 row 同 date,industry_category 字典序 ASC tie-breaker。"""
    ...

def test_dedup_override_table_wins() -> None:
    """E4: _PRIMARY_INDUSTRY_OVERRIDE["2330"]="半導體業" 無論 FinMind 回什麼順序皆此值。"""
    ...

def test_dedup_filters_non_twse_tpex_keeps_both() -> None:
    """v3 B4: type='index' / 'other' 過濾;type='twse' AND type='tpex' 兩者
    皆保留(對稱 assertion 鎖住正反兩向避免 typo regression `('twse',)`-only)。"""
    rows = [
        {"stock_id": "2330", "industry_category": "半導體業",
         "type": "twse", "date": "2026-06-26"},
        {"stock_id": "3231", "industry_category": "電子零組件業",
         "type": "tpex", "date": "2026-06-26"},
        {"stock_id": "TAIEX", "industry_category": "指數",
         "type": "index", "date": "2026-06-26"},
        {"stock_id": "OTHER", "industry_category": "?",
         "type": "other", "date": "2026-06-26"},
    ]
    out = _dedup_sector_map(rows)
    assert out["2330"] == "半導體業"       # twse 保留
    assert out["3231"] == "電子零組件業"   # tpex 保留(B4 鎖)
    assert "TAIEX" not in out               # index 過濾
    assert "OTHER" not in out               # other 過濾

def test_dedup_missing_industry_falls_to_qita() -> None:
    """E1: industry_category 為 None / 空 → '其他'。"""
    ...


# --- _compute_leaderboards (F5 含 volume_ratio) ---

def test_leaderboards_gainers_sorted_desc() -> None:
    """SC-3: gainers by change_rate desc top size 個。"""
    ...

def test_leaderboards_losers_sorted_asc() -> None:
    """SC-3: losers by change_rate asc。"""
    ...

def test_leaderboards_amount_sorted_desc() -> None:
    """SC-3: amount by total_amount desc。"""
    ...

def test_leaderboards_volume_ratio_sorted_desc() -> None:
    """SC-3: volume_ratio by volume_ratio desc;None 視為 0。"""
    ...

def test_trim_includes_volume_ratio_field() -> None:
    """v3 F5: _trim 必須含 volume_ratio key,None 也要保留。"""
    rows = [{"stock_id": "9999", "name": "X", "change_rate": 1.0,
             "total_amount": 1000, "sector": "電子工業"}]
    out = _trim(rows)
    assert "volume_ratio" in out[0]


# --- _max_tick_date (E5 / v3 B3) ---

def test_max_tick_date_with_microseconds() -> None:
    """v3 B3: FinMind 真實 ISO `2026-06-29 13:29:50.123456` 能 parse。"""
    universe = [{"date": "2026-06-29 13:29:50.123456", "stock_id": "2330"}]
    ts = _max_tick_date(universe)
    assert ts is not None
    assert ts.microsecond == 123456

def test_max_tick_date_picks_latest() -> None:
    """v3 B3: 多 row 混順序 → 取 max 不取 first/last 順序依賴。"""
    universe = [
        {"date": "2026-06-29 10:00:00", "stock_id": "A"},
        {"date": "2026-06-29 13:00:00", "stock_id": "B"},
        {"date": "2026-06-29 11:00:00", "stock_id": "C"},
    ]
    ts = _max_tick_date(universe)
    assert ts.hour == 13 and ts.minute == 0

def test_max_tick_date_empty_returns_none() -> None:
    """v3 B3: 空 universe → None。"""
    assert _max_tick_date([]) is None


# --- _group_by_sector (E1 / E2) ---

def test_group_by_sector_caps_stocks() -> None:
    """SC-2: 每 sector cap 30 個(取 market_value 大者)。"""
    ...

def test_group_by_sector_orphan_to_qita() -> None:
    """E1: primary_sector 沒 mapping 的 stock_id → 進 '其他' sector。"""
    ...

def test_group_by_sector_market_value_fallback_to_median() -> None:
    """E2: 缺 market_value 的 stock → sector 內 median,有 tooltip flag。"""
    ...


# --- fetch_market_snapshot (整測,mock FinMindClient) ---

@pytest.mark.usefixtures("bypass_finmind_rate_limiter")
async def test_fetch_market_snapshot_happy_path() -> None:
    """SC-1: mock FinMindClient,所有 3 個 fetch 成功 → return shape 對齊 §4 contract。"""
    ...

async def test_fetch_market_snapshot_universe_fail_with_cache() -> None:
    """E7: universe fetch fail + disk cache 存在 → return stale=True。"""
    ...

async def test_fetch_market_snapshot_all_fail_no_cache() -> None:
    """E7: 全失敗 + 無 cache → raise ValueError('finmind_unreachable')。"""
    ...

async def test_fetch_market_snapshot_payload_under_50kb() -> None:
    """SC-1 measurement gate(v3 F10):mock 28 sector × 30 stock 滿 → payload
    json.dumps(...).encode() < 50000。"""
    ...
```

**SC mapping**:全部 → SC-1(snapshot pipeline)+ SC-3(leaderboard)+ E1/E2/E4/E7。
