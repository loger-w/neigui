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
# Pure functions — AD Line / RANA / McClellan
# ---------------------------------------------------------------------------


def compute_ad_line(counts: list[tuple[date, int, int]]) -> list[dict]:
    """Cumulative AD Line: value[t] = value[t-1] + (up[t] - down[t])."""
    out: list[dict] = []
    running = 0.0
    for d, up, down in counts:
        running += float(up - down)
        out.append({"date": d.isoformat(), "value": running})
    return out


def compute_rana(counts: list[tuple[date, int, int]]) -> list[dict]:
    """RANA[t] = (up-down) / (up+down); denominator 0 → 0.0 (edge E6)."""
    out: list[dict] = []
    for d, up, down in counts:
        denom = up + down
        val = (up - down) / denom if denom else 0.0
        out.append({"date": d.isoformat(), "value": val})
    return out


def _ema(values: list[float], period: int) -> list[float | None]:
    """Standard EMA with SMA seed.

    Returns list same length as input.
    前 period-1 點 None;第 period 點 = 前 period 點 SMA(seed),
    之後 α=2/(period+1) 遞推。
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
    """McClellan = fast-EMA(RANA) - slow-EMA(RANA); 前 slow-1 點 value=None."""
    values = [float(r["value"]) for r in rana_series]
    fast_ema = _ema(values, fast)
    slow_ema = _ema(values, slow)
    out: list[dict] = []
    for r, f, s in zip(rana_series, fast_ema, slow_ema, strict=True):
        val = (f - s) if (f is not None and s is not None) else None
        out.append({"date": r["date"], "value": val})
    return out


# ---------------------------------------------------------------------------
# Signal detectors
# ---------------------------------------------------------------------------


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
    - TAIEX close 於窗內達新高 (max) 且 mcc last 未同步新高 → 'bearish'
    - TAIEX close 於窗內達新低 (min) 且 mcc last 未同步新低 → 'bullish'
    - 否則 None
    TAIEX 空 → None
    """
    if not taiex_series or not mcclellan_series:
        return None
    tail_taiex = [float(r["value"]) for r in taiex_series[-window:] if r.get("value") is not None]
    tail_mcc = [float(r["value"]) for r in mcclellan_series[-window:] if r.get("value") is not None]
    if not tail_taiex or not tail_mcc:
        return None
    tx_last = tail_taiex[-1]
    mcc_last = tail_mcc[-1]
    if tx_last >= max(tail_taiex) and mcc_last < max(tail_mcc):
        return "bearish"
    if tx_last <= min(tail_taiex) and mcc_last > min(tail_mcc):
        return "bullish"
    return None


# ---------------------------------------------------------------------------
# Daily up/down counter (F5 — E2/E4 handling)
# ---------------------------------------------------------------------------


def _count_daily_ups_downs(
    prices: list[dict],
    universe: set[str],
) -> list[tuple[date, int, int]]:
    """從 daily price rows 算每日 (up, down) 家數。

    F5 §4.2 rules:
    - stock_id not in universe → skip
    - close > prev_close → up++;close < prev_close → down++;== → 不計 (spec §6.3)
    - 無 prev_close(新上市 / 首日)→ 該日該股 skip (E2)
    - 日期軸 = 實際回傳 date 的 union (E4)
    """
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

    daily: dict[date, tuple[int, int]] = {}
    for _sid, rows in grouped.items():
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


# ---------------------------------------------------------------------------
# Fetchers
# ---------------------------------------------------------------------------


async def _fetch_daily_prices_window(
    start: date,
    end: date,
    refresh: bool = False,
) -> list[dict]:
    """FinMind TaiwanStockPrice date-range (全 universe)."""
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
                {
                    "rows": rows,
                    "fetched_at": datetime.now().isoformat(timespec="seconds"),
                },
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
    """Compute breadth (AD Line + McClellan + signals) for universe over lookback.

    設計:.claude/feat/market-breadth-mcclellan/design.md v2 §4.1
    """
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
