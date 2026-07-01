# Implementation Plan — services/market_breadth.py

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:test-driven-development`(main agent 自己 TDD,≤ 2 檔 pattern per /feat Phase 3 表)。Steps 用 checkbox 追蹤。

**Goal**:實作 `services/market_breadth.py`,提供 `compute_breadth()` 產出 McClellan Oscillator + AD Line breadth 指標,整合到 `services/finmind_realtime.py` snapshot payload。

**Architecture**:純函式(compute)/ fetcher(async)分離。純函式 SC-1~3 直接餵 fixture 測。Fetcher 走 P1 `market_universe.py` 的 `_run_once` + `_read_cache/_write_cache/_is_fresh` pattern。Orchestrator SC-4 走 monkeypatch 注入 stub。

**Tech Stack**:Python 3.12 async / httpx / FinMind TaiwanStockPrice dataset / pytest asyncio_mode=auto / `services/clock.py::today()` for time indirection

## Global Constraints(design.md 全域)

- `from __future__ import annotations` 第一行(CLAUDE.md §2)
- Type hints 無例外(CLAUDE.md §2)
- Logger `logger = logging.getLogger(__name__)`,禁 print
- narrow except:`httpx.HTTPError` / `ValueError`;不裸 `except`
- get_finmind indirection:module 內 wrap,tests patch module symbol
- 錯誤處理:CLAUDE.md §F 不 swallow;raise 傳 propagate 到上層
- 三 commit tag:`[red]` / `[green]` / `[refactor]`
- 對應 SC-N 逐條 red-first
- Cache 慣例:`_CACHE_VERSION_BREADTH = 1`,`_BREADTH_TTL_HOURS = 24`,mirror `services/market_universe.py`

---

## File Structure

| 檔案 | 責任 |
|---|---|
| `backend/services/market_breadth.py` | 純函式 + fetcher + `compute_breadth` orchestrator + `BreadthResult` TypedDict |
| `backend/tests/test_market_breadth.py` | ≥ 8 tests(SC-1~5)|
| `backend/services/finmind_realtime.py` | `_fetch_breadth` helper + snapshot payload `breadth` 欄位(不動 stale)|
| `backend/tests/test_finmind_realtime.py`(既有)| 加 1 integration test 驗 SC-6 |

---

### Task 1(SC-1): `compute_ad_line` 累加

**Files:**
- Create: `backend/services/market_breadth.py`(第一次落地,含 header + BreadthResult TypedDict + `compute_ad_line`)
- Create: `backend/tests/test_market_breadth.py`(第一個 test)

**Interfaces:**
- Produces: `compute_ad_line(counts: list[tuple[date, int, int]]) -> list[dict]`
  - counts = `[(date, up_count, down_count)]`
  - 回傳 `[{"date": "YYYY-MM-DD", "value": float}]`,`value[t] = value[t-1] + (up - down)`,`value[0] = up - down`

- [ ] **Step 1: 寫 failing test(SC-1)**
```python
# backend/tests/test_market_breadth.py
"""Tests for services/market_breadth.py — SC-1~5 coverage."""

from __future__ import annotations

from datetime import date

from services import market_breadth as mb


class TestComputeAdLine:
    def test_compute_ad_line_accumulates(self) -> None:
        counts = [
            (date(2026, 6, 20), 100, 50),   # +50
            (date(2026, 6, 21), 80, 90),    # -10 → 40
            (date(2026, 6, 22), 200, 100),  # +100 → 140
        ]
        result = mb.compute_ad_line(counts)
        assert [r["date"] for r in result] == ["2026-06-20", "2026-06-21", "2026-06-22"]
        assert [r["value"] for r in result] == [50.0, 40.0, 140.0]
```

- [ ] **Step 2: Run test, expect FAIL(ModuleNotFoundError 或 AttributeError)**
```
cd backend && python -m pytest tests/test_market_breadth.py::TestComputeAdLine::test_compute_ad_line_accumulates -x -v
```
Expected: FAIL

- [ ] **Step 3: 建 market_breadth.py 檔頭 + `compute_ad_line`**
```python
# backend/services/market_breadth.py
"""Phase 2 — market breadth service (McClellan Oscillator + AD Line).

Spec: docs/specs/market-monitor-v2/spec.md §6.3 / plan.md Phase 2.
Design: .claude/feat/market-breadth-mcclellan/design.md v2

輸入 universe(來自 P1 filter)+ end_date + lookback_days → BreadthResult
(累計 AD Line + 19-39 EMA McClellan + 3 種訊號 dot)。
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import TypedDict

import httpx

from utils.cache import atomic_write_json, chip_cache_dir, read_json

logger = logging.getLogger(__name__)

_FINMIND_BASE = "https://api.finmindtrade.com/api/v4"
_CACHE_VERSION_BREADTH = 1
_BREADTH_TTL_HOURS = 24
_SLOW_EMA_PERIOD = 39
_FAST_EMA_PERIOD = 19
_DEFAULT_LOOKBACK_DAYS = 60
_DEFAULT_DIVERGENCE_WINDOW = 20
_DEFAULT_THRUST_THRESHOLD = 100.0

_inflight: dict[str, asyncio.Task] = {}


class BreadthResult(TypedDict):
    ad_line_value: float
    mcclellan_oscillator: float | None
    ad_line_series: list[dict]
    mcclellan_series: list[dict]
    thrust_dot: str | None
    centerline_cross: str | None
    divergence_dot: str | None
    known_gaps: list[str]


# ---------------------------------------------------------------------------
# Pure functions
# ---------------------------------------------------------------------------


def compute_ad_line(counts: list[tuple[date, int, int]]) -> list[dict]:
    """Cumulative AD Line: value[t] = value[t-1] + (up[t] - down[t])."""
    out: list[dict] = []
    running = 0.0
    for d, up, down in counts:
        running += float(up - down)
        out.append({"date": d.isoformat(), "value": running})
    return out
```

- [ ] **Step 4: Run test, expect PASS**
- [ ] **Step 5: 兩 commit(F4 fix — [red] 🔴, [green] 🟢,對齊 CLAUDE.md 用戶 global 慣例 + Phase 8 tag validation)**
```bash
# [red] — test 檔先 commit(此時 impl 檔尚未 add,不會混入 stage)
git add backend/tests/test_market_breadth.py
git commit -m "🔴 test(market-breadth): add SC-1 compute_ad_line failing test [red]"

# [green] — impl 檔後 commit(body 註 red→green 對應 sha,Phase 8 sequence check)
git add backend/services/market_breadth.py
git commit -m "🟢 feat(market-breadth): implement compute_ad_line [green]

red→green for <previous-red-sha>"
```

**注意**:Step 5 pattern 對 Task 2-8 全套用 — [red] 用 🔴、[green] 用 🟢,禁止把 impl 檔和 test 檔同 stage。這是 Phase 8 `git log --grep '\[red\]'` count > 0 + 每 [green] 對應 [red] 配對機械化驗證的前置條件。

---

### Task 2(SC-2 part 1): `compute_rana`

**Files:**
- Modify: `backend/services/market_breadth.py`(加 `compute_rana`)
- Modify: `backend/tests/test_market_breadth.py`(加 test)

**Interfaces:**
- Produces: `compute_rana(counts) -> list[dict]`
  - `RANA[t] = (up - down) / (up + down)`,分母 0 → 0.0(E6 handle)

- [ ] **Step 1: 寫 red test**
```python
class TestComputeRana:
    def test_rana_normal(self) -> None:
        counts = [
            (date(2026, 6, 20), 100, 50),   # 50/150 = 0.333...
            (date(2026, 6, 21), 80, 80),    # 0/160 = 0
        ]
        result = mb.compute_rana(counts)
        assert result[0]["value"] == 50 / 150
        assert result[1]["value"] == 0.0

    def test_rana_zero_denominator(self) -> None:
        counts = [(date(2026, 6, 20), 0, 0)]
        result = mb.compute_rana(counts)
        assert result[0]["value"] == 0.0
```

- [ ] **Step 2: Run FAIL**
- [ ] **Step 3: 實作**
```python
def compute_rana(counts: list[tuple[date, int, int]]) -> list[dict]:
    """RANA[t] = (up-down) / (up+down); denominator 0 → 0.0."""
    out: list[dict] = []
    for d, up, down in counts:
        denom = up + down
        val = (up - down) / denom if denom else 0.0
        out.append({"date": d.isoformat(), "value": val})
    return out
```
- [ ] **Step 4: PASS**
- [ ] **Step 5: [red] + [green] two-commit**

---

### Task 3(SC-2 part 2): `compute_mcclellan` (19-EMA - 39-EMA)

**Files:**
- Modify: `market_breadth.py` + `test_market_breadth.py`

**Interfaces:**
- Produces: `compute_mcclellan(rana_series, fast=19, slow=39) -> list[dict]`
  - EMA α = 2/(N+1);seed 用前 N 天 SMA
  - warm-up:前 slow-1 (38) 點 value=None
  - McClellan[t] = EMA_fast[t] - EMA_slow[t]

- [ ] **Step 1: red test — 手算 fixture**
```python
class TestComputeMcclellan:
    def test_mcclellan_warmup_returns_none(self) -> None:
        # 少於 slow=39 天 → 全部 None
        rana = [{"date": f"2026-06-{i:02d}", "value": 0.1 * i} for i in range(1, 10)]
        result = mb.compute_mcclellan(rana, fast=19, slow=39)
        assert all(r["value"] is None for r in result)
        assert len(result) == 9

    def test_mcclellan_small_periods_hand_calc(self) -> None:
        # 用 fast=2, slow=3 手算驗證邏輯
        # SMA seed:前 3 天平均當作 slow EMA 第 3 天值
        # RANA = [1, 2, 3, 4, 5]
        # slow(3): seed at idx=2 = (1+2+3)/3 = 2.0
        #   idx=3: α=0.5, prev=2.0, new=(4-2.0)*0.5+2.0 = 3.0
        #   idx=4: (5-3.0)*0.5+3.0 = 4.0
        # fast(2): seed at idx=1 = (1+2)/2 = 1.5
        #   idx=2: α=2/3, prev=1.5, new=(3-1.5)*(2/3)+1.5 = 2.5
        #   idx=3: (4-2.5)*(2/3)+2.5 = 3.5
        #   idx=4: (5-3.5)*(2/3)+3.5 = 4.5
        # mcclellan = fast - slow:
        #   idx 0,1: None (fast/slow warm-up)
        #   idx=2: 2.5 - 2.0 = 0.5
        #   idx=3: 3.5 - 3.0 = 0.5
        #   idx=4: 4.5 - 4.0 = 0.5
        rana = [{"date": f"d{i}", "value": float(i)} for i in range(1, 6)]
        result = mb.compute_mcclellan(rana, fast=2, slow=3)
        assert result[0]["value"] is None
        assert result[1]["value"] is None
        assert result[2]["value"] == pytest.approx(0.5)
        assert result[3]["value"] == pytest.approx(0.5)
        assert result[4]["value"] == pytest.approx(0.5)
```
(test 檔頭加 `import pytest`)

- [ ] **Step 2: Run FAIL**
- [ ] **Step 3: 實作**
```python
def _ema(values: list[float], period: int) -> list[float | None]:
    """Standard EMA with SMA seed.
    Returns list same length as input;前 period-1 點 None,
    第 period 點 = 前 period 點 SMA(seed),之後 α=2/(period+1) 遞推。
    """
    n = len(values)
    out: list[float | None] = [None] * n
    if n < period:
        return out
    seed = sum(values[:period]) / period
    out[period - 1] = seed
    alpha = 2.0 / (period + 1)
    prev = seed
    for i in range(period, n):
        prev = (values[i] - prev) * alpha + prev
        out[i] = prev
    return out


def compute_mcclellan(
    rana_series: list[dict],
    fast: int = _FAST_EMA_PERIOD,
    slow: int = _SLOW_EMA_PERIOD,
) -> list[dict]:
    """McClellan = fast-EMA(RANA) - slow-EMA(RANA); warm-up 前 slow-1 點 None."""
    values = [float(r["value"]) for r in rana_series]
    fast_ema = _ema(values, fast)
    slow_ema = _ema(values, slow)
    out: list[dict] = []
    for r, f, s in zip(rana_series, fast_ema, slow_ema, strict=True):
        val = (f - s) if (f is not None and s is not None) else None
        out.append({"date": r["date"], "value": val})
    return out
```
- [ ] **Step 4: PASS**
- [ ] **Step 5: [red] + [green]**

---

### Task 4(SC-3): 三種訊號偵測

**Files:** 同上

**Interfaces:**
- Produces:
  - `detect_thrust_dot(mcclellan_series, threshold=100.0) -> str | None`
  - `detect_centerline_cross(mcclellan_series) -> str | None`
  - `detect_divergence(mcclellan_series, taiex_series, window=20) -> str | None`

- [ ] **Step 1: red test(三個一起,同一 class)**
```python
class TestSignalDetectors:
    def test_thrust_dot_above_plus_100(self) -> None:
        series = [{"date": "d1", "value": 105.0}]
        assert mb.detect_thrust_dot(series) == "above_plus_100"

    def test_thrust_dot_below_minus_100(self) -> None:
        series = [{"date": "d1", "value": -110.0}]
        assert mb.detect_thrust_dot(series) == "below_minus_100"

    def test_thrust_dot_within_returns_none(self) -> None:
        series = [{"date": "d1", "value": 50.0}]
        assert mb.detect_thrust_dot(series) is None

    def test_thrust_dot_last_none_returns_none(self) -> None:
        series = [{"date": "d1", "value": None}]
        assert mb.detect_thrust_dot(series) is None

    def test_centerline_cross_up(self) -> None:
        series = [{"date": "d0", "value": -5.0}, {"date": "d1", "value": 10.0}]
        assert mb.detect_centerline_cross(series) == "above"

    def test_centerline_cross_down(self) -> None:
        series = [{"date": "d0", "value": 5.0}, {"date": "d1", "value": -10.0}]
        assert mb.detect_centerline_cross(series) == "below"

    def test_centerline_same_sign_none(self) -> None:
        series = [{"date": "d0", "value": 5.0}, {"date": "d1", "value": 10.0}]
        assert mb.detect_centerline_cross(series) is None

    def test_divergence_bearish(self) -> None:
        # TAIEX 越後越高(20-day max 在最後)但 mcc 越後越低
        mcc = [{"date": f"d{i}", "value": 100 - i * 5} for i in range(20)]
        taiex = [{"date": f"d{i}", "value": float(1000 + i * 10)} for i in range(20)]
        assert mb.detect_divergence(mcc, taiex, window=20) == "bearish"

    def test_divergence_bullish(self) -> None:
        # TAIEX 越後越低(min 在最後)但 mcc 越後越高(min 不在最後)
        mcc = [{"date": f"d{i}", "value": -100 + i * 5} for i in range(20)]
        taiex = [{"date": f"d{i}", "value": float(1000 - i * 10)} for i in range(20)]
        assert mb.detect_divergence(mcc, taiex, window=20) == "bullish"

    def test_divergence_taiex_empty_returns_none(self) -> None:
        mcc = [{"date": "d1", "value": 50.0}]
        assert mb.detect_divergence(mcc, [], window=20) is None
```

- [ ] **Step 2: Run FAIL**
- [ ] **Step 3: 實作三個 detector**
```python
def detect_thrust_dot(
    mcclellan_series: list[dict],
    threshold: float = _DEFAULT_THRUST_THRESHOLD,
) -> str | None:
    if not mcclellan_series:
        return None
    last = mcclellan_series[-1].get("value")
    if last is None:
        return None
    if last > threshold:
        return "above_plus_100"
    if last < -threshold:
        return "below_minus_100"
    return None


def detect_centerline_cross(mcclellan_series: list[dict]) -> str | None:
    if len(mcclellan_series) < 2:
        return None
    prev = mcclellan_series[-2].get("value")
    curr = mcclellan_series[-1].get("value")
    if prev is None or curr is None:
        return None
    if prev < 0 <= curr:
        return "above"
    if prev >= 0 > curr:
        return "below"
    return None


def detect_divergence(
    mcclellan_series: list[dict],
    taiex_series: list[dict],
    window: int = _DEFAULT_DIVERGENCE_WINDOW,
) -> str | None:
    """近 window 天內:
    - TAIEX last close == max(recent window) 且 mcc last != max → bearish
    - TAIEX last close == min(recent window) 且 mcc last != min → bullish
    - 否則 None
    """
    if not taiex_series or not mcclellan_series:
        return None
    tail_taiex = [float(r["value"]) for r in taiex_series[-window:] if r.get("value") is not None]
    tail_mcc = [
        float(r["value"]) for r in mcclellan_series[-window:] if r.get("value") is not None
    ]
    if not tail_taiex or not tail_mcc:
        return None
    tx_last = tail_taiex[-1]
    mcc_last = tail_mcc[-1]
    if tx_last >= max(tail_taiex) and mcc_last < max(tail_mcc):
        return "bearish"
    if tx_last <= min(tail_taiex) and mcc_last > min(tail_mcc):
        return "bullish"
    return None
```
- [ ] **Step 4: PASS**
- [ ] **Step 5: [red] + [green]**

---

### Task 5(F5 / edge E2/E4): `_count_daily_ups_downs`

**Interfaces:**
- Produces: `_count_daily_ups_downs(prices, universe) -> list[tuple[date, int, int]]`

- [ ] **Step 1: red test**
```python
class TestCountDailyUpsDowns:
    def test_count_basic(self) -> None:
        prices = [
            {"stock_id": "2330", "date": "2026-06-20", "close": 100.0},
            {"stock_id": "2330", "date": "2026-06-21", "close": 110.0},  # up
            {"stock_id": "2317", "date": "2026-06-20", "close": 50.0},
            {"stock_id": "2317", "date": "2026-06-21", "close": 45.0},   # down
        ]
        counts = mb._count_daily_ups_downs(prices, universe={"2330", "2317"})
        # 只有 06-21 有 prev_close,06-20 無 prev → skip
        assert counts == [(date(2026, 6, 21), 1, 1)]

    def test_count_skips_non_universe(self) -> None:
        prices = [
            {"stock_id": "0050", "date": "2026-06-20", "close": 100.0},
            {"stock_id": "0050", "date": "2026-06-21", "close": 110.0},
            {"stock_id": "2330", "date": "2026-06-20", "close": 500.0},
            {"stock_id": "2330", "date": "2026-06-21", "close": 490.0},
        ]
        counts = mb._count_daily_ups_downs(prices, universe={"2330"})
        assert counts == [(date(2026, 6, 21), 0, 1)]

    def test_count_flat_not_counted(self) -> None:
        # close == prev_close 不計 up/down(F5 §8.6 決策)
        prices = [
            {"stock_id": "2330", "date": "2026-06-20", "close": 100.0},
            {"stock_id": "2330", "date": "2026-06-21", "close": 100.0},
        ]
        counts = mb._count_daily_ups_downs(prices, universe={"2330"})
        assert counts == [(date(2026, 6, 21), 0, 0)]

    def test_count_missing_row_skipped(self) -> None:
        # E2:新上市股 06-20 無 row,06-21 有 → 該股該日 skip 無 prev_close
        prices = [
            {"stock_id": "2330", "date": "2026-06-20", "close": 100.0},
            {"stock_id": "2330", "date": "2026-06-21", "close": 110.0},
            {"stock_id": "NEW1", "date": "2026-06-21", "close": 30.0},  # 無 prev → skip
        ]
        counts = mb._count_daily_ups_downs(prices, universe={"2330", "NEW1"})
        assert counts == [(date(2026, 6, 21), 1, 0)]

    def test_count_sparse_dates_natural_axis(self) -> None:
        # E4:連假 → 日期軸 = 實際回傳 date 的 union,不填 NaN
        prices = [
            {"stock_id": "2330", "date": "2026-06-20", "close": 100.0},
            {"stock_id": "2330", "date": "2026-06-23", "close": 110.0},  # 21-22 連假
            {"stock_id": "2330", "date": "2026-06-24", "close": 105.0},
        ]
        counts = mb._count_daily_ups_downs(prices, universe={"2330"})
        dates = [d for d, _, _ in counts]
        assert dates == [date(2026, 6, 23), date(2026, 6, 24)]  # 21-22 not present
```

- [ ] **Step 2: Run FAIL**
- [ ] **Step 3: 實作**
```python
def _count_daily_ups_downs(
    prices: list[dict],
    universe: set[str],
) -> list[tuple[date, int, int]]:
    """從 daily price rows 算每日 (up, down) 家數。

    F5 §4.2 rules:
    - stock_id not in universe → skip
    - close > prev_close → up++;close < prev_close → down++;== → 不計(spec §6.3)
    - 無 prev_close(新上市 / 首日)→ 該日該股 skip
    - 日期軸 = 實際回傳 date 的 union(不填 NaN)

    Assumes prices 已按 (stock_id, date) 排序或不排序(內部 group + sort)。
    """
    # group by stock_id, sort each by date
    grouped: dict[str, list[tuple[date, float]]] = {}
    for row in prices:
        sid = row.get("stock_id")
        d_raw = row.get("date")
        c_raw = row.get("close")
        if sid is None or d_raw is None or c_raw is None:
            continue
        if sid not in universe:
            continue
        try:
            d = date.fromisoformat(str(d_raw))
            c = float(c_raw)
        except (ValueError, TypeError):
            continue
        grouped.setdefault(sid, []).append((d, c))

    # 對每股 sort by date,產出 (stock_id, curr_date, direction) tuples
    daily: dict[date, tuple[int, int]] = {}
    for sid, rows in grouped.items():
        rows.sort(key=lambda x: x[0])
        prev_close: float | None = None
        for d, c in rows:
            if prev_close is None:
                prev_close = c
                continue
            up_add = 1 if c > prev_close else 0
            down_add = 1 if c < prev_close else 0
            existing = daily.get(d, (0, 0))
            daily[d] = (existing[0] + up_add, existing[1] + down_add)
            prev_close = c

    return sorted([(d, u, dn) for d, (u, dn) in daily.items()])
```
- [ ] **Step 4: PASS**
- [ ] **Step 5: [red] + [green]**

---

### Task 6(SC-4): `compute_breadth` orchestrator + cache helpers + fetcher

**Interfaces:**
- Consumes: (from Tasks 1-5) `compute_ad_line` / `compute_rana` / `compute_mcclellan` / `detect_*` / `_count_daily_ups_downs`
- Produces: `compute_breadth(end_date, universe, lookback_days=60, refresh=False) -> BreadthResult`
  - `_fetch_daily_prices_window(start, end, refresh) -> list[dict]`
  - `_fetch_taiex_series(start, end, refresh) -> list[dict]`
  - `get_finmind()` indirection

- [ ] **Step 1: red test — orchestrator + fetcher inject**
```python
class TestComputeBreadth:
    async def test_compute_breadth_shape(self, monkeypatch) -> None:
        # F2 fix — 60 天 fixture 留 20+ mcclellan valid points(避 razor-thin warm-up)
        # 用 timedelta 生連續 date 避手工 rollover 出錯
        prices = []
        base = date(2026, 4, 1)
        dates_iso = [(base + timedelta(days=i)).isoformat() for i in range(60)]
        for i, d in enumerate(dates_iso):
            prices.append({"stock_id": "2330", "date": d, "close": 100.0 + i})
            prices.append({"stock_id": "2317", "date": d, "close": 50.0 - i * 0.5})
        taiex = [{"date": d, "value": 17000.0 + i * 10} for i, d in enumerate(dates_iso)]

        async def fake_prices(start, end, refresh=False):
            return prices

        async def fake_taiex(start, end, refresh=False):
            # taiex_series expects [{"date", "value"}] but fetcher return raw
            # payload with {"date", "close"} — orchestrator responsible for shape
            return [{"date": r["date"], "close": r["value"]} for r in taiex]

        monkeypatch.setattr(mb, "_fetch_daily_prices_window", fake_prices)
        monkeypatch.setattr(mb, "_fetch_taiex_series", fake_taiex)

        result = await mb.compute_breadth(
            end_date=date(2026, 5, 30),
            universe={"2330", "2317"},
            lookback_days=30,
        )
        assert "ad_line_value" in result
        assert "mcclellan_oscillator" in result
        assert isinstance(result["ad_line_series"], list)
        assert isinstance(result["mcclellan_series"], list)
        # ad_line_series 每點必有 date + value
        assert all("date" in r and "value" in r for r in result["ad_line_series"])
        assert result["known_gaps"] == []

    async def test_compute_breadth_uses_injected_universe(self, monkeypatch) -> None:
        # universe filter 生效:0050 不 in universe → counts 忽略它
        prices = [
            {"stock_id": "2330", "date": "2026-06-20", "close": 100.0},
            {"stock_id": "2330", "date": "2026-06-21", "close": 110.0},
            {"stock_id": "0050", "date": "2026-06-20", "close": 200.0},
            {"stock_id": "0050", "date": "2026-06-21", "close": 100.0},
        ]

        async def fake_prices(*a, **kw):
            return prices

        async def fake_taiex(*a, **kw):
            return []

        monkeypatch.setattr(mb, "_fetch_daily_prices_window", fake_prices)
        monkeypatch.setattr(mb, "_fetch_taiex_series", fake_taiex)

        result = await mb.compute_breadth(
            end_date=date(2026, 6, 21),
            universe={"2330"},  # exclude 0050
            lookback_days=5,
        )
        # 只有 2330 (up 1) → AD Line 最後值 = 1
        assert result["ad_line_value"] == 1.0
        # taiex empty → divergence_dot None + known_gaps 含 "taiex_unavailable"
        assert result["divergence_dot"] is None
        assert "taiex_unavailable" in result["known_gaps"]


class TestFetchTaiexSeriesFallback:
    """F3 fix — 直接覆蓋 _do_fetch_taiex 的 TAIEX→0001 fallback loop
    + empty check + cache write on double fail(design v2 §4.3 語意)。"""

    async def test_fetch_taiex_series_all_sid_fail_returns_empty(
        self, monkeypatch, tmp_path
    ) -> None:
        # tmp CHIP_DATA_DIR 已由 conftest autouse 設好
        calls: list[str] = []

        class FakeClient:
            async def _get(self, url, params):
                calls.append(params.get("data_id"))
                return []  # 兩 sid 都回 empty

        monkeypatch.setattr(mb, "get_finmind", lambda: FakeClient())

        # 強制 cache miss(用未來 date)
        end = date(2026, 12, 31)
        start = end - timedelta(days=90)
        result = await mb._fetch_taiex_series(start, end, refresh=True)

        assert result == []
        assert calls == ["TAIEX", "0001"]  # fallback loop 兩 sid 都試過
        # cache 有寫(避免下次再打 FinMind)— 檔案存在且 rows=[]
        cache_file = mb._cache_path(f"breadth_taiex_{end.isoformat()}")
        assert cache_file.exists()
        cached = mb._read_cache(f"breadth_taiex_{end.isoformat()}")
        assert cached is not None
        assert cached["rows"] == []

    async def test_fetch_taiex_series_taiex_ok_no_fallback(
        self, monkeypatch
    ) -> None:
        """TAIEX 第一次就成功 → 不打 0001"""
        calls: list[str] = []

        class FakeClient:
            async def _get(self, url, params):
                sid = params.get("data_id")
                calls.append(sid)
                if sid == "TAIEX":
                    return [{"date": "2026-06-30", "close": 17000.0}]
                return []  # 不該打到

        monkeypatch.setattr(mb, "get_finmind", lambda: FakeClient())
        end = date(2026, 6, 30)
        start = end - timedelta(days=90)
        result = await mb._fetch_taiex_series(start, end, refresh=True)

        assert calls == ["TAIEX"]  # 沒 fallback 到 0001
        assert len(result) == 1
        assert result[0]["close"] == 17000.0
```

- [ ] **Step 2: Run FAIL(NameError: compute_breadth)**
- [ ] **Step 3: 實作 cache helpers + fetchers + orchestrator**
```python
# ---------------------------------------------------------------------------
# get_finmind indirection (tests patch this module symbol)
# ---------------------------------------------------------------------------


def get_finmind():
    from services.finmind import get_finmind as _real

    return _real()


# ---------------------------------------------------------------------------
# Cache helpers (mirror services/market_universe.py)
# ---------------------------------------------------------------------------


def _cache_path(key: str) -> Path:
    return chip_cache_dir() / f"{key}.json"


def _read_cache(key: str) -> dict | None:
    p = _cache_path(key)
    if not p.exists():
        return None
    data = read_json(p, default=None)
    if data is None or data.get("_cache_version") != _CACHE_VERSION_BREADTH:
        return None
    data.pop("_cache_version", None)
    return data


def _write_cache(key: str, payload: dict) -> None:
    cached = {**payload, "_cache_version": _CACHE_VERSION_BREADTH}
    atomic_write_json(_cache_path(key), cached)


def _is_fresh(cached: dict, ttl_hours: float) -> bool:
    fetched_at = cached.get("fetched_at", "")
    if not fetched_at:
        return False
    try:
        dt = datetime.fromisoformat(fetched_at)
    except ValueError:
        return False
    return datetime.now() - dt < timedelta(hours=ttl_hours)


async def _run_once(key: str, coro_fn):
    if key in _inflight:
        return await _inflight[key]
    _inflight[key] = asyncio.ensure_future(coro_fn())
    try:
        return await _inflight[key]
    finally:
        _inflight.pop(key, None)


# ---------------------------------------------------------------------------
# Fetchers
# ---------------------------------------------------------------------------


async def _fetch_daily_prices_window(
    start: date,
    end: date,
    refresh: bool = False,
) -> list[dict]:
    """FinMind TaiwanStockPrice date-range (all stocks)."""
    cache_key = f"breadth_prices_{end.isoformat()}"
    dedup_key = f"{cache_key}_r{int(refresh)}"
    if not refresh:
        cached = _read_cache(cache_key)
        if cached is not None and _is_fresh(cached, _BREADTH_TTL_HOURS):
            return cached.get("rows", [])
    return await _run_once(
        dedup_key,
        lambda: _do_fetch_prices(start, end, cache_key),
    )


async def _do_fetch_prices(start: date, end: date, cache_key: str) -> list[dict]:
    client = get_finmind()
    rows = await client._get(  # type: ignore[attr-defined]
        f"{_FINMIND_BASE}/data",
        {
            "dataset": "TaiwanStockPrice",
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
        },
    )
    _write_cache(
        cache_key,
        {"rows": rows, "fetched_at": datetime.now().isoformat(timespec="seconds")},
    )
    return rows


async def _fetch_taiex_series(
    start: date,
    end: date,
    refresh: bool = False,
) -> list[dict]:
    """Try TAIEX then 0001; return [] on both fail."""
    cache_key = f"breadth_taiex_{end.isoformat()}"
    dedup_key = f"{cache_key}_r{int(refresh)}"
    if not refresh:
        cached = _read_cache(cache_key)
        if cached is not None and _is_fresh(cached, _BREADTH_TTL_HOURS):
            return cached.get("rows", [])
    return await _run_once(
        dedup_key,
        lambda: _do_fetch_taiex(start, end, cache_key),
    )


async def _do_fetch_taiex(start: date, end: date, cache_key: str) -> list[dict]:
    client = get_finmind()
    for sid in ("TAIEX", "0001"):
        try:
            rows = await client._get(  # type: ignore[attr-defined]
                f"{_FINMIND_BASE}/data",
                {
                    "dataset": "TaiwanStockPrice",
                    "data_id": sid,
                    "start_date": start.isoformat(),
                    "end_date": end.isoformat(),
                },
            )
        except httpx.HTTPError as exc:
            logger.warning("TAIEX fetch failed for sid=%s: %s", sid, exc)
            continue
        if rows:
            _write_cache(
                cache_key,
                {"rows": rows, "fetched_at": datetime.now().isoformat(timespec="seconds")},
            )
            return rows
    logger.warning("TAIEX all candidates returned empty; divergence_dot will be None")
    _write_cache(
        cache_key,
        {"rows": [], "fetched_at": datetime.now().isoformat(timespec="seconds")},
    )
    return []


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


async def compute_breadth(
    end_date: date,
    universe: set[str],
    lookback_days: int = _DEFAULT_LOOKBACK_DAYS,
    refresh: bool = False,
) -> BreadthResult:
    """Compute breadth (AD Line + McClellan + signals) for universe over lookback window."""
    if not universe:
        raise ValueError("universe_empty")

    # F2: window derivation ensures slow EMA warmup + lookback_days valid points
    pad_days = int((lookback_days + _SLOW_EMA_PERIOD) * 1.5)
    start = end_date - timedelta(days=pad_days)

    prices = await _fetch_daily_prices_window(start, end_date, refresh=refresh)
    taiex_raw = await _fetch_taiex_series(start, end_date, refresh=refresh)

    counts = _count_daily_ups_downs(prices, universe)
    ad_line = compute_ad_line(counts)
    rana = compute_rana(counts)
    mcc = compute_mcclellan(rana)

    # TAIEX series shape: [{"date", "value"}] where value = close
    taiex_series: list[dict] = []
    for r in taiex_raw:
        d = r.get("date")
        c = r.get("close")
        if d is None or c is None:
            continue
        try:
            taiex_series.append({"date": str(d), "value": float(c)})
        except (ValueError, TypeError):
            continue

    known_gaps: list[str] = []
    if not taiex_series:
        known_gaps.append("taiex_unavailable")

    ad_line_value = ad_line[-1]["value"] if ad_line else 0.0
    mcc_last = mcc[-1]["value"] if mcc else None

    return BreadthResult(
        ad_line_value=float(ad_line_value),
        mcclellan_oscillator=mcc_last,
        ad_line_series=ad_line,
        mcclellan_series=mcc,
        thrust_dot=detect_thrust_dot(mcc),
        centerline_cross=detect_centerline_cross(mcc),
        divergence_dot=detect_divergence(mcc, taiex_series),
        known_gaps=known_gaps,
    )
```

- [ ] **Step 4: PASS**
- [ ] **Step 5: [red] + [green]**

---

### Task 7(SC-5): edge cases — empty universe / TAIEX 全失敗

- [ ] **Step 1: red tests**
```python
class TestComputeBreadthEdges:
    async def test_compute_breadth_empty_universe_raises(self) -> None:
        with pytest.raises(ValueError, match="universe_empty"):
            await mb.compute_breadth(
                end_date=date(2026, 6, 30),
                universe=set(),
            )

    async def test_compute_breadth_taiex_fetch_fail_divergence_null(
        self, monkeypatch
    ) -> None:
        async def fake_prices(*a, **kw):
            return [
                {"stock_id": "2330", "date": "2026-06-20", "close": 100.0},
                {"stock_id": "2330", "date": "2026-06-21", "close": 110.0},
            ]

        async def fake_taiex(*a, **kw):
            return []  # 模擬 TAIEX 兩個 sid 都失敗

        monkeypatch.setattr(mb, "_fetch_daily_prices_window", fake_prices)
        monkeypatch.setattr(mb, "_fetch_taiex_series", fake_taiex)
        result = await mb.compute_breadth(
            end_date=date(2026, 6, 21),
            universe={"2330"},
            lookback_days=5,
        )
        assert result["divergence_dot"] is None
        assert "taiex_unavailable" in result["known_gaps"]
        # 主體資料仍回
        assert result["ad_line_series"]
```

- [ ] **Step 2: Run — empty universe 先紅(NameError 沒 raise)**
- [ ] **Step 3: 實作已在 Task 6 orchestrator 內 handle,若失敗補**
- [ ] **Step 4: PASS**
- [ ] **Step 5: [red] + [green]**

---

### Task 8(SC-6): 整合 `services/finmind_realtime.py`

**Files:**
- Modify: `backend/services/finmind_realtime.py`(加 `import httpx`(F1 fix)+ `_fetch_breadth` helper + snapshot payload `breadth` 欄位)
- Modify: `backend/tests/test_finmind_realtime.py`(加 2 integration test)

**Interfaces:**
- Consumes: `market_breadth.compute_breadth`
- Produces: `_fetch_breadth(end_date, universe, refresh) -> dict | None`

**F5 fix**:新 test 對齊既有 `test_finmind_realtime.py` 慣例 — `with patch(...) as` + `AsyncMock`,不用 `monkeypatch.setattr`。

- [ ] **Step 1: red integration test**

```python
# backend/tests/test_finmind_realtime.py 追加(既有頂端已 import AsyncMock, patch)
from unittest.mock import AsyncMock, patch

FAKE_BREADTH_PAYLOAD = {
    "ad_line_value": 100.0,
    "mcclellan_oscillator": 20.0,
    "ad_line_series": [{"date": "2026-06-30", "value": 100.0}],
    "mcclellan_series": [{"date": "2026-06-30", "value": 20.0}],
    "thrust_dot": None,
    "centerline_cross": None,
    "divergence_dot": None,
    "known_gaps": [],
}


async def test_snapshot_payload_adds_breadth() -> None:
    from services import finmind_realtime as fr

    fake_universe = [{
        "stock_id": "2330", "change_rate": 0.5, "total_amount": 1000,
        "date": "2026-06-30T13:30:00",
    }]
    fake_sector_rows = [{
        "stock_id": "2330", "type": "twse", "industry_category": "半導體業",
        "date": "2026-06-30", "stock_name": "台積電",
    }]

    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=fake_universe)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=fake_sector_rows)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 12_000_000})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth",
               new=AsyncMock(return_value=FAKE_BREADTH_PAYLOAD)):
        snap = await fr.fetch_market_snapshot(refresh=False)

    # P2 new field
    assert snap["breadth"] == FAKE_BREADTH_PAYLOAD
    # P1 fields 完整
    assert "universe_size" in snap
    assert "excluded_count" in snap
    # 舊 4 panel 完整
    assert set(snap["leaderboards"].keys()) == {"gainers", "losers", "amount", "volume_ratio"}
    # stale 不因 breadth 拉紅(F6)
    assert snap["stale"] is False


async def test_snapshot_breadth_fail_does_not_flip_stale() -> None:
    """F6:breadth fail → breadth=None,stale 不動。"""
    import httpx
    from services import finmind_realtime as fr

    fake_universe = [{
        "stock_id": "2330", "change_rate": 0.5, "total_amount": 1000,
        "date": "2026-06-30T13:30:00",
    }]
    fake_sector_rows = [{
        "stock_id": "2330", "type": "twse", "industry_category": "半導體業",
        "date": "2026-06-30", "stock_name": "台積電",
    }]

    with patch("services.finmind_realtime._fetch_universe",
               new=AsyncMock(return_value=fake_universe)), \
         patch("services.finmind_realtime._fetch_sector_map",
               new=AsyncMock(return_value=fake_sector_rows)), \
         patch("services.finmind_realtime._fetch_market_value_map",
               new=AsyncMock(return_value={"2330": 12_000_000})), \
         patch("services.finmind_realtime._fetch_watch_list",
               new=AsyncMock(return_value=set())), \
         patch("services.finmind_realtime._fetch_breadth",
               new=AsyncMock(side_effect=httpx.HTTPError("simulated"))):
        snap = await fr.fetch_market_snapshot(refresh=False)

    assert snap["breadth"] is None
    assert snap["stale"] is False  # F6 lock — breadth fail 不動 stale
```

- [ ] **Step 2: Run FAIL**
- [ ] **Step 3: 實作 `_fetch_breadth` + integrate**

先加 module-level import(F1 fix)到 `services/finmind_realtime.py`:
```python
# 加入 top-of-file import 區
import httpx
```

新增 helper:
```python
async def _fetch_breadth(
    end_date: date,
    universe: set[str],
    refresh: bool = False,
) -> dict | None:
    """P2 — delegate to market_breadth.compute_breadth。
    empty universe → None(不 raise,silent skip)。
    Exception path 由 caller 用 try/except 處理(F6)。"""
    if not universe:
        return None
    from services import market_breadth as mb

    return await mb.compute_breadth(end_date, universe, refresh=refresh)
```

在 `_do_fetch_market_snapshot` 內,`allowed` 產出後、`return {...}` 前加:
```python
# P2 market-monitor-v2 §6.3 — breadth (McClellan + AD Line)
try:
    breadth = await _fetch_breadth(clock.today(), allowed, refresh=refresh)
except (httpx.HTTPError, ValueError) as exc:
    # F6: breadth fail 不拉 stale(EOD data ≠ intraday degradation)
    logger.warning("market snapshot: breadth compute failed: %s", exc)
    breadth = None
```

`return { ... }` 內最後加 `"breadth": breadth`。

- [ ] **Step 4: PASS**(SC-6 兩 test 綠 + 既有 test_finmind_realtime 全綠)
- [ ] **Step 5: [red] + [green]**

---

## Failing test 清單 → SC-N 對應

| Test class / name | SC | 對應 §design |
|---|---|---|
| `test_compute_ad_line_accumulates` | SC-1 | §4.2 `compute_ad_line` |
| `test_rana_normal` / `test_rana_zero_denominator` | SC-2 | §4.2 `compute_rana` |
| `test_mcclellan_warmup_returns_none` / `_hand_calc` | SC-2 | §4.2 `compute_mcclellan` + `_ema` |
| `test_thrust_dot_*`(4) | SC-3 | §4.2 `detect_thrust_dot` |
| `test_centerline_cross_*`(3) | SC-3 | §4.2 `detect_centerline_cross` |
| `test_divergence_*`(3) | SC-3 | §4.2 `detect_divergence` |
| `test_count_*`(5,F5) | SC-2 support | §4.2 `_count_daily_ups_downs` |
| `test_compute_breadth_shape` / `_uses_injected_universe` | SC-4 | §4.1 orchestrator |
| `test_fetch_taiex_series_all_sid_fail_returns_empty` / `_taiex_ok_no_fallback` | SC-5 (F3) | §4.3 `_do_fetch_taiex` fallback loop + cache write |
| `test_compute_breadth_empty_universe_raises` | SC-5 | §4.1 raise |
| `test_compute_breadth_taiex_fetch_fail_divergence_null` | SC-5 | §4.3 TAIEX fallback |
| `test_snapshot_payload_adds_breadth` | SC-6 | §4.4 integrate |
| `test_snapshot_breadth_fail_does_not_flip_stale` | SC-6 (F6) | §4.4 stale lock |

**Total:25 failing tests(≥ plan.md Phase 2 要求 6)**

---

## Known Risks(implementation-level)

- **IR1**:`_count_daily_ups_downs` unchanged 處理選擇 `不計 up/down`(§8.6)— 若 Phase 6 real-env 顯示分子總數偏低 → 改成 up++,V2.5 backtest 決定
- **IR2**(F3 fix, revised):TAIEX 兩個 sid fallback loop / empty check / cache write on double-fail **有** unit test 覆蓋(`TestFetchTaiexSeriesFallback` class,見 Task 6)。real FinMind 打真實 TAIEX 這條 path 屬 Phase 6 real-env 驗證範圍(需 valid token)
