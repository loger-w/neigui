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

_DEFAULT_LOOKBACK_DAYS = 60  # matches market_breadth._DEFAULT_LOOKBACK_DAYS
_MA_WINDOW = 20  # SC-1 MA20
_VOL_AVG_WINDOW = 20  # SC-3 default avg_window
_VOL_HOT_THRESHOLD = 1.5
_VOL_COLD_THRESHOLD = 0.7
_OTHER_SECTOR = "其他"


# ---------------------------------------------------------------------------
# TypedDict payload shapes
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# §3.1 _extract_close_and_volume_by_stock — pure
# ---------------------------------------------------------------------------


def _extract_close_and_volume_by_stock(
    prices: list[dict],
    universe: set[str],
) -> dict[str, dict[date, tuple[float, int]]]:
    """Build stock_id → { date → (close, volume_shares) }.

    Same (sid, date) duplicate → later value wins (F6-echo).
    Volume unit = shares (int); orchestrator divides by 1000 later.
    """
    out: dict[str, dict[date, tuple[float, int]]] = {}
    for row in prices:
        sid = row.get("stock_id")
        if sid is None or sid not in universe:
            continue
        d_raw = row.get("date")
        c_raw = row.get("close")
        if d_raw is None or c_raw is None:
            continue
        try:
            d = date.fromisoformat(str(d_raw))
            c = float(c_raw)
        except (ValueError, TypeError):
            continue
        v_raw = row.get("Trading_Volume", 0)
        try:
            v = int(v_raw) if v_raw is not None else 0
        except (ValueError, TypeError):
            v = 0
        out.setdefault(sid, {})[d] = (c, v)
    return out


# ---------------------------------------------------------------------------
# §3.2 _compute_ma20 — pure
# ---------------------------------------------------------------------------


def _compute_ma20(closes_sorted_asc: list[float], window: int = _MA_WINDOW) -> float | None:
    """Inclusive MA (F9): mean of the last `window` closes.

    < window → None.
    """
    if len(closes_sorted_asc) < window:
        return None
    tail = closes_sorted_asc[-window:]
    return sum(tail) / window


# ---------------------------------------------------------------------------
# §3.3 _aggregate_sector_breadth — pure
# ---------------------------------------------------------------------------


def _all_dates(by_stock: dict[str, dict[date, tuple[float, int]]]) -> list[date]:
    seen: set[date] = set()
    for per_date in by_stock.values():
        seen.update(per_date.keys())
    return sorted(seen)


def _aggregate_sector_breadth(
    by_stock: dict[str, dict[date, tuple[float, int]]],
    sector_map: dict[str, str],
    today_date: date | None = None,
) -> list[SectorBreadthResult]:
    """Per-sector: count(close_today > ma20) / count(effective members)."""
    if not by_stock:
        return []
    if today_date is None:
        all_dates = _all_dates(by_stock)
        if not all_dates:
            return []
        today_date = all_dates[-1]

    per_sector_totals: dict[str, list[bool]] = {}
    for sid, per_date in by_stock.items():
        # Ordered closes up to and including today_date (F9 inclusive MA)
        dates_up_to_today = sorted(d for d in per_date if d <= today_date)
        if not dates_up_to_today:
            continue
        closes_asc = [per_date[d][0] for d in dates_up_to_today]
        ma20 = _compute_ma20(closes_asc)
        if ma20 is None:
            continue
        today_pair = per_date.get(today_date)
        if today_pair is None:
            continue  # F7 — global today: no row this day → drop
        today_close = today_pair[0]
        sector = sector_map.get(sid, _OTHER_SECTOR)
        per_sector_totals.setdefault(sector, []).append(today_close > ma20)

    results: list[SectorBreadthResult] = []
    for sector, flags in per_sector_totals.items():
        members = len(flags)
        if members == 0:
            continue
        above = sum(1 for f in flags if f)
        results.append(
            SectorBreadthResult(
                sector=sector,
                members=members,
                above_ma20=above,
                pct=above / members,
            )
        )
    # Sort pct DESC, tie-break sector ASC
    results.sort(key=lambda r: (-r["pct"], r["sector"]))
    return results


# ---------------------------------------------------------------------------
# §3.4 _aggregate_sector_volume_ratio — pure
# ---------------------------------------------------------------------------


def _aggregate_sector_volume_ratio(
    by_stock: dict[str, dict[date, tuple[float, int]]],
    sector_map: dict[str, str],
    avg_window: int = _VOL_AVG_WINDOW,
    today_date: date | None = None,
) -> list[SectorVolResult]:
    """Per-sector: today_vol_lots / mean(past N days sector daily_vol_sum)."""
    if not by_stock:
        return []
    if today_date is None:
        all_dates = _all_dates(by_stock)
        if not all_dates:
            return []
        today_date = all_dates[-1]

    # Build sector → date → sum_volume_shares
    sector_day_vol: dict[str, dict[date, int]] = {}
    for sid, per_date in by_stock.items():
        sector = sector_map.get(sid, _OTHER_SECTOR)
        bucket = sector_day_vol.setdefault(sector, {})
        for d, (_close, vol) in per_date.items():
            bucket[d] = bucket.get(d, 0) + vol

    results: list[SectorVolResult] = []
    for sector, day_vol in sector_day_vol.items():
        today_vol_shares = day_vol.get(today_date, 0)
        if today_vol_shares == 0:
            continue
        today_vol_lots = today_vol_shares // 1000
        past_days_sorted = sorted(day_vol.items(), key=lambda x: x[0], reverse=True)
        past_vols = [v for d, v in past_days_sorted if d < today_date][:avg_window]
        if len(past_vols) < avg_window:
            vol_ratio: float | None = None
        else:
            past_mean = sum(past_vols) / len(past_vols)
            if past_mean == 0:
                vol_ratio = None
            else:
                vol_ratio = today_vol_shares / past_mean
        if vol_ratio is None:
            flag: str | None = None
        elif vol_ratio > _VOL_HOT_THRESHOLD:
            flag = "hot"
        elif vol_ratio < _VOL_COLD_THRESHOLD:
            flag = "cold"
        else:
            flag = None
        results.append(
            SectorVolResult(
                sector=sector,
                today_vol_lots=today_vol_lots,
                vol_ratio=vol_ratio,
                flag=flag,
            )
        )

    # F1 None-safe sort: (vol_ratio is None, -(vol_ratio or 0.0), sector_asc)
    results.sort(
        key=lambda r: (
            r["vol_ratio"] is None,
            -(r["vol_ratio"] if r["vol_ratio"] is not None else 0.0),
            r["sector"],
        )
    )
    return results


# ---------------------------------------------------------------------------
# §3.5 _fetch_prices_window — thin delegate to P2 for cache_key reuse
# ---------------------------------------------------------------------------


async def _fetch_prices_window(
    start: date,
    end: date,
    refresh: bool = False,
) -> list[dict]:
    """Delegate to services.market_breadth._fetch_daily_prices_window.

    Shares cache_key `breadth_prices_<start>_<end>` — cold fetch runs once for
    P2 breadth + P3 sector_breadth + P3 sector_volume_ratio (KG3 mitigation).
    Tests patch **this** module's symbol, not market_breadth's.

    F4: silently inherits P2 partial-fetch semantic (no known_gaps surfacing).
    """
    from services import market_breadth as mb

    return await mb._fetch_daily_prices_window(start, end, refresh=refresh)


# ---------------------------------------------------------------------------
# §3.6 / §3.7 Public orchestrators
# ---------------------------------------------------------------------------


def _derive_window(end_date: date, lookback_days: int) -> tuple[date, date]:
    """Match P2 window derivation for shared cache_key.

    pad_days = (lookback_days + _SLOW_EMA_PERIOD) * 2.0
    (R5 lock — see test_sector_aggregation.py::TestConstantsLock)
    """
    from services import market_breadth as mb

    pad_days = int((lookback_days + mb._SLOW_EMA_PERIOD) * 2.0)
    return end_date - timedelta(days=pad_days), end_date


async def compute_sector_breadth(
    end_date: date,
    universe: set[str],
    sector_map: dict[str, str],
    lookback_days: int = _DEFAULT_LOOKBACK_DAYS,
    refresh: bool = False,
) -> list[SectorBreadthResult]:
    """Aggregate per-sector breadth (% close > MA20).

    Empty universe → raises ValueError("universe_empty").
    Empty prices from fetcher (F3) → returns [].
    Sorted by pct DESC, tie-break sector name ASC.
    """
    if not universe:
        raise ValueError("universe_empty")
    start, end = _derive_window(end_date, lookback_days)
    prices = await _fetch_prices_window(start, end, refresh=refresh)
    by_stock = _extract_close_and_volume_by_stock(prices, universe)
    return _aggregate_sector_breadth(by_stock, sector_map)


async def compute_sector_volume_ratio(
    end_date: date,
    universe: set[str],
    sector_map: dict[str, str],
    lookback_days: int = _DEFAULT_LOOKBACK_DAYS,
    avg_window: int = _VOL_AVG_WINDOW,
    refresh: bool = False,
) -> list[SectorVolResult]:
    """Aggregate per-sector today volume ratio vs past N-day average.

    Empty universe → raises ValueError("universe_empty").
    Empty prices from fetcher (F3) → returns [].
    Sort: non-None vol_ratio DESC first, None last, tie-break sector ASC.
    """
    if not universe:
        raise ValueError("universe_empty")
    start, end = _derive_window(end_date, lookback_days)
    prices = await _fetch_prices_window(start, end, refresh=refresh)
    by_stock = _extract_close_and_volume_by_stock(prices, universe)
    return _aggregate_sector_volume_ratio(by_stock, sector_map, avg_window=avg_window)
