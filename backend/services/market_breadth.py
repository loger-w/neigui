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

from services.trading_calendar import get_trading_days
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
    - TAIEX 收盤於窗內達 **strict** 新高 且 mcc last 未同步新高 → 'bearish'
    - TAIEX 收盤於窗內達 **strict** 新低 且 mcc last 未同步新低 → 'bullish'
    - 否則 None(TAIEX 空 / mcc 空 / 資料不足)

    F3 fix (review round 1):嚴格 `>` / `<` 對 flat TAIEX 情境 (all 20 values 相等)
    不誤觸發 bearish。
    F5 fix:mcc / taiex 先 by-date inner-join 再 slice,避免 axis mismatch
    (mcc dates = universe 交易日 union;taiex dates = TAIEX endpoint)。
    """
    if not taiex_series or not mcclellan_series:
        return None
    # F5: date-align — build dict for O(1) join lookup
    tx_by_date = {r["date"]: r["value"] for r in taiex_series if r.get("value") is not None}
    aligned: list[tuple[float, float]] = []  # (taiex, mcc) same-date pairs
    for r in mcclellan_series:
        mcc_val = r.get("value")
        if mcc_val is None:
            continue
        tx_val = tx_by_date.get(r.get("date"))
        if tx_val is None:
            continue
        aligned.append((float(tx_val), float(mcc_val)))
    if not aligned:
        return None
    tail = aligned[-window:]
    if len(tail) < 2:  # F3: 嚴格新高需 window ≥ 2
        return None
    tx_last, mcc_last = tail[-1]
    tx_prev = [t for t, _ in tail[:-1]]
    mcc_prev = [m for _, m in tail[:-1]]
    # F3: 嚴格 `>` — flat TAIEX (tx_last == max prev) 不算新高
    # mcc non-confirming = mcc_last 沒超越 prev peak → 嚴格 `<`
    if tx_last > max(tx_prev) and mcc_last < max(mcc_prev):
        return "bearish"
    if tx_last < min(tx_prev) and mcc_last > min(mcc_prev):
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
    # F6 fix (review round 1):per-stock dedup by date — FinMind duplicate
    # (stock_id, date) row 會產生首日 phantom (0, 0) 且破壞 axis。
    # 用 dict-per-stock keep last close per date。
    grouped: dict[str, dict[date, float]] = {}
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
        # 同 (sid, date) duplicate → 用 later value 覆蓋(FinMind 通常 later
        # 是修正值)
        grouped.setdefault(sid, {})[d] = c

    daily: dict[date, tuple[int, int]] = {}
    for _sid, per_date in grouped.items():
        rows = sorted(per_date.items(), key=lambda x: x[0])
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
    """FinMind TaiwanStockPrice date-range (全 universe).

    F2 fix (review round 1):cache_key + dedup_key 加 start 避免不同
    lookback_days 同 end concurrent 撞 lambda 閉包 → 拿到第一個 caller
    的窄 window。
    """
    cache_key = f"breadth_prices_{start.isoformat()}_{end.isoformat()}"
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
    """Fetch TaiwanStockPrice全 universe over [start, end] window.

    Phase 6 real-env finding (2026-07-01):FinMind TaiwanStockPrice **without
    data_id** ignores `start_date`/`end_date` range and only returns rows for
    `start_date` (single day). Design v2 §8.1 假設打紅 → 改 per-trading-day loop:
    每個交易日 1 call,累積 rows。100 天 × 15 req/s = ~7s first-fetch,24h
    cache 攤還後續 request 幾乎零成本。
    """
    client = get_finmind()
    # 拿 [start, end] 之間的 trading days;get_trading_days(end, n) 回最近 n 天,
    # 拿 300 天足以涵蓋 default window (200 pad) 之後 filter 到 [start, end]。
    recent = await get_trading_days(end, 300)
    trading_days = sorted(d for d in recent if start <= d <= end)
    if not trading_days:
        logger.warning(
            "market_breadth: no trading days in window %s..%s",
            start.isoformat(),
            end.isoformat(),
        )
        _write_cache(
            cache_key,
            {"rows": [], "fetched_at": datetime.now().isoformat(timespec="seconds")},
        )
        return []

    all_rows: list[dict] = []
    for td in trading_days:
        try:
            rows = await client._get(  # type: ignore[attr-defined]
                f"{_FINMIND_BASE}/data",
                {
                    "dataset": "TaiwanStockPrice",
                    "start_date": td.isoformat(),
                    "end_date": td.isoformat(),
                },
            )
        except httpx.HTTPError as exc:
            # 單日 fail 不 abort 整 window(spec §F narrow except:continue
            # 對其他 trading day 是唯一具體處理策略,不是 swallow)
            logger.warning(
                "market_breadth: daily price fetch failed for %s: %s",
                td.isoformat(),
                exc,
            )
            continue
        all_rows.extend(rows)
    _write_cache(
        cache_key,
        {"rows": all_rows, "fetched_at": datetime.now().isoformat(timespec="seconds")},
    )
    return all_rows


async def _fetch_taiex_series(
    start: date,
    end: date,
    refresh: bool = False,
) -> list[dict]:
    """Try TAIEX then 0001; return [] on both empty; re-raise on all-raise."""
    # F2 fix: cache_key + dedup_key 加 start
    cache_key = f"breadth_taiex_{start.isoformat()}_{end.isoformat()}"
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
    """Try TAIEX then 0001。

    F1 correctness fix (review round 1):
    - 兩 sid 皆成功 200 但 rows=[] → cache empty 24h(FinMind 明確說「無資料」)
    - 至少一 sid 200 且有資料 → cache 該 rows
    - 兩 sid 全 raise httpx.HTTPError → re-raise 最後 exception
      (caller `_fetch_breadth`/`_do_fetch_market_snapshot` 的 try/except
      handle → breadth=None for this cycle,不動 stale,next request 會 retry)
      避免 transient 5xx / DNS blip pin 到 24h TTL empty cache。
    """
    client = get_finmind()
    saw_response = False
    last_exc: httpx.HTTPError | None = None
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
            last_exc = exc
            continue
        saw_response = True
        if rows:
            _write_cache(
                cache_key,
                {
                    "rows": rows,
                    "fetched_at": datetime.now().isoformat(timespec="seconds"),
                },
            )
            return rows
    if not saw_response:
        # F1: 兩 sid 全 raise → 不 pin cache,re-raise 讓 caller 處理
        assert last_exc is not None
        raise last_exc
    logger.warning(
        "TAIEX all candidates returned empty (200 OK, no rows); "
        "divergence_dot will be None for %sh",
        _BREADTH_TTL_HOURS,
    )
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

    # F2 (design) + F4 (review round 1 correctness):
    # 1.5 → 2.0 multiplier — 春節連 9 天非交易日窗口,1.5 有時 collapse 到
    # trading day 收成 < 39 + lookback。2.0 給充分 margin(V2.5 若要精準
    # 改用 trading_calendar 反推)。
    pad_days = int((lookback_days + _SLOW_EMA_PERIOD) * 2.0)
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
