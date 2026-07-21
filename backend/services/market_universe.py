"""Phase 1 — market universe filter service.

Spec: docs/specs/market-monitor-v2/spec.md §6.1 / plan.md Phase 1.

排除規則:
- ETF: stock_id startswith "00"(0050 / 0056 / 00919 …)
- 權證 / 衍生品: stock_id 長度 != 4 或含非 digit(7XXXXX / TDR / 字母後綴)
- 注意處置股: FinMind TaiwanStockDispositionSecuritiesPeriod period_start <= today <= period_end

Watch list source: FinMind dataset `TaiwanStockDispositionSecuritiesPeriod`(處置股 only)。
注意股無對應 FinMind dataset(P1 known gap),後續視需求 fallback TWSE OpenAPI。
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx

from services import clock
from utils.cache import atomic_write_json, chip_cache_dir, read_json
from utils.concurrency import run_once

logger = logging.getLogger(__name__)

_FINMIND_BASE = "https://api.finmindtrade.com/api/v4"
_CACHE_VERSION_UNIVERSE = 1
_DISPOSITION_TTL_HOURS = 24
_DISPOSITION_LOOKBACK_DAYS = 60  # 處置期間最長見過 ~30 天,60 天 buffer

_inflight: dict[str, dict[str, Any]] = {}


# ---------------------------------------------------------------------------
# get_finmind indirection — tests patch this module-level symbol
# ---------------------------------------------------------------------------


def get_finmind():
    from services.finmind import get_finmind as _real

    return _real()


# ---------------------------------------------------------------------------
# Pure classification
# ---------------------------------------------------------------------------


def classify_stock_id(stock_id: str) -> str | None:
    """Classify stock_id by structure only(not by lookup).

    Returns:
        "etf" — `00` prefix(ETF / 統一基金,4-6 位皆涵蓋)
        "warrant" — 長度 != 4 或含非 digit(權證 / 衍生品 / 警示後綴)
        None — 4 位純數字非 `00` prefix → 普通股 candidate

    Note:
        Watch list(處置股)需走 FinMind dataset 對映,非結構檢測,不在此函式內判斷。
    """
    s = (stock_id or "").strip()
    if not s:
        return "warrant"
    if s.startswith("00"):
        return "etf"
    if len(s) != 4 or not s.isdigit():
        return "warrant"
    return None


def filter_universe(
    candidates: list[str],
    watch_list: set[str],
) -> dict:
    """Partition candidate stock_ids into universe + excluded buckets.

    watch_list 優先於 classify 結果:同時是普通股 + 處置股 → 歸入 watch_list 桶。
    """
    universe: set[str] = set()
    etf: list[str] = []
    warrant: list[str] = []
    watch_excluded: list[str] = []

    for sid in candidates:
        if sid in watch_list:
            watch_excluded.append(sid)
            continue
        bucket = classify_stock_id(sid)
        if bucket == "etf":
            etf.append(sid)
        elif bucket == "warrant":
            warrant.append(sid)
        else:
            universe.add(sid)

    return {
        "universe": universe,
        "excluded": {
            "etf": etf,
            "warrant": warrant,
            "watch_list": watch_excluded,
        },
    }


# ---------------------------------------------------------------------------
# Cache helpers(對齊 services/finmind_realtime.py 慣例)
# ---------------------------------------------------------------------------


def _cache_path(key: str) -> Path:
    return chip_cache_dir() / f"{key}.json"


def _read_cache(key: str) -> dict | None:
    p = _cache_path(key)
    if not p.exists():
        return None
    data = read_json(p, default=None)
    if data is None:
        return None
    if data.get("_cache_version") != _CACHE_VERSION_UNIVERSE:
        return None
    data.pop("_cache_version", None)
    return data


def _write_cache(key: str, payload: dict) -> None:
    cached = {**payload, "_cache_version": _CACHE_VERSION_UNIVERSE}
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


async def _run_once(key: str, coro_fn: Callable[[], Awaitable[Any]]) -> Any:
    """Inflight dedup — 委派 utils.concurrency.run_once(refcount + shield;
    F-3 收斂,spec SC-2 拍板由裸 await 版升級 refcount 語意)。"""
    return await run_once(_inflight, key, coro_fn)


# ---------------------------------------------------------------------------
# Watch list source — FinMind TaiwanStockDispositionSecuritiesPeriod
# ---------------------------------------------------------------------------


async def fetch_disposition_stocks(
    today: date | None = None,
    refresh: bool = False,
) -> set[str]:
    """Return set of stock_id whose 處置期間 covers `today`.

    Cache 24h(處置公告 daily 更新)。lookback 60 天保險,FinMind 回 full window
    後 in-memory filter 出 period_start <= today <= period_end。
    """
    if today is None:
        today = clock.today()
    cache_key = f"disposition_{today.isoformat()}"
    if not refresh:
        cached = _read_cache(cache_key)
        if cached is not None and _is_fresh(cached, _DISPOSITION_TTL_HOURS):
            return set(cached.get("stock_ids", []))

    return await _run_once(
        cache_key,
        lambda: _do_fetch_disposition(today, cache_key),
    )


async def _do_fetch_disposition(today: date, cache_key: str) -> set[str]:
    """Fetch + parse disposition rows;cache 成功 result only。

    Phase 4 review P1 fix:
    - 窄 except 至 `httpx.HTTPError`(對齊 services/finmind.py:357 / 500 / 575 慣例)
    - 失敗時 **不寫 cache + raise** — 否則 swallow + empty cache 24h TTL 會讓
      整天 disposition 過濾失效,且上層 `_fetch_watch_list` 的 `gather
      return_exceptions=True` fallback path 永遠不 trigger,stale signal 死掉
    - 上層 `_do_fetch_market_snapshot` 已用 `return_exceptions=True` graceful
      handle,raise 不會破 snapshot 整體可用性
    - CLAUDE.md §F:「不懂的 error 不要 catch;catch 後要有具體處理邏輯」
    """
    start = today - timedelta(days=_DISPOSITION_LOOKBACK_DAYS)
    client = get_finmind()
    try:
        rows = await client._get(  # type: ignore[attr-defined]
            f"{_FINMIND_BASE}/data",
            {
                "dataset": "TaiwanStockDispositionSecuritiesPeriod",
                "start_date": start.isoformat(),
                "end_date": today.isoformat(),
            },
        )
    except httpx.HTTPError:
        logger.exception("disposition fetch failed (httpx error); propagating to caller")
        raise

    active = _parse_active_disposition(rows, today)

    _write_cache(
        cache_key,
        {
            "stock_ids": sorted(active),
            "fetched_at": datetime.now().isoformat(timespec="seconds"),
        },
    )
    return active


def _parse_active_disposition(rows: list[dict], today: date) -> set[str]:
    """Filter rows to stock_ids whose period covers today."""
    active: set[str] = set()
    for row in rows:
        sid = row.get("stock_id")
        ps = row.get("period_start")
        pe = row.get("period_end")
        if not (sid and ps and pe):
            continue
        try:
            ps_d = date.fromisoformat(ps)
            pe_d = date.fromisoformat(pe)
        except ValueError:
            continue
        if ps_d <= today <= pe_d:
            active.add(sid)
    return active


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


async def get_filtered_universe(
    today: date | None = None,
    refresh: bool = False,
) -> dict:
    """Fetch TaiwanStockInfo + disposition,partition,return universe + excluded.

    Shape:
        {
            "universe": set[str],
            "excluded": {"etf": [...], "warrant": [...], "watch_list": [...]},
        }
    """
    if today is None:
        today = clock.today()

    client = get_finmind()
    info_rows, watch_list = await asyncio.gather(
        client._get(  # type: ignore[attr-defined]
            f"{_FINMIND_BASE}/data",
            {"dataset": "TaiwanStockInfo"},
        ),
        fetch_disposition_stocks(today=today, refresh=refresh),
    )

    candidates = [r["stock_id"] for r in info_rows if r.get("stock_id")]
    # dedup,維持插入順序
    seen: set[str] = set()
    deduped: list[str] = []
    for sid in candidates:
        if sid in seen:
            continue
        seen.add(sid)
        deduped.append(sid)
    return filter_universe(deduped, watch_list=watch_list)
